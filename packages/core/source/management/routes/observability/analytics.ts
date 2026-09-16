import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import type { ManagementHandler } from '../../core/response'
import { sendError, sendSuccess } from '../../core/response'
import { AnalyticsRangeSchema, type AnalyticsSummary, type ModelStat, type ProviderAnalyticsDetail } from '@common/schemas'
import { resolveAnalyticsBuckets } from '@common/analytics-buckets'
import { tokensPerSecondFromTotals } from '@common/metrics'
import {
  getStatsSummary,
  getUsageTrend,
  getUsageHeat,
  getProviderStats,
  getProviderStat,
  getProviderAnalyticsTrend,
  getModelStats,
  getLatencyDistribution,
  getFailureReasons,
  getRequestSourceStats,
  type ModelStat as DatabaseModelStat,
} from '@server/database/analytics-store'
import { HttpRouter } from '@server/http-router'

export const analyticsRoutes = new HttpRouter<ManagementHandler>()
  .post('/api/analytics/summary', handleAnalyticsSummary)
  .post('/api/analytics/provider-detail', handleProviderAnalyticsDetail)

const AnalyticsSummaryRequestSchema = z.object({
  range: AnalyticsRangeSchema.optional().default('7d'),
})

const ProviderAnalyticsRequestSchema = z.object({
  providerId: z.string().trim().min(1),
  range: AnalyticsRangeSchema.optional().default('7d'),
})

async function handleAnalyticsSummary(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const { range } = AnalyticsSummaryRequestSchema.parse(body ?? {})
  // 时间窗与粒度都从查询范围推导一次，后续所有查询共用同一份结论（`@common/analytics-buckets`）。
  // 用量分布的粒度也来自这里：它的格宽与格数同样是范围的函数，只是比趋势桶细。
  const buckets = resolveAnalyticsBuckets(range)
  const { sinceMs } = buckets

  const [trend, heat, summary, providerStats, modelStats, latencyDistribution, failureReasons, sourceStats] = await Promise.all([
    getUsageTrend(buckets),
    getUsageHeat(buckets),
    getStatsSummary(sinceMs),
    getProviderStats(sinceMs),
    getModelStats(sinceMs, 10),
    getLatencyDistribution(sinceMs, buckets.latencyTargetBins),
    getFailureReasons(sinceMs),
    getRequestSourceStats(sinceMs),
  ])

  const totalProviderAttempts = providerStats.reduce((total, provider) => total + provider.attempts, 0)
  const totalFailures = summary.failedCount

  const providerStatsWithPercent = providerStats.map(p => ({
    ...p,
    percent: totalProviderAttempts > 0 ? Math.round((p.attempts / totalProviderAttempts) * 100) : 0,
  }))

  const modelStatsWithRate = modelStats.map(mapModelStat)

  // 延迟分布的口径是「成功的上游尝试」，因此分母必须是分布自身的样本总数，
  // 而不是请求数：一个请求可能贡献多次尝试，拿请求数当分母会让占比超过 100%。
  const latencySamples = latencyDistribution.reduce((total, bucket) => total + bucket.count, 0)
  const latencyWithPercent = latencyDistribution.map(l => ({
    ...l,
    percent: latencySamples > 0 ? Math.round((l.count / latencySamples) * 100) : 0,
  }))

  const failureWithPercent = failureReasons.map(f => ({
    ...f,
    percent: totalFailures > 0 ? Math.round((f.count / totalFailures) * 100) : 0,
  }))

  const response: AnalyticsSummary = {
    summary,
    trendIntervalMs: buckets.trendIntervalMs,
    heatIntervalMs: buckets.heatIntervalMs,
    trend,
    heat,
    providerStats: providerStatsWithPercent,
    modelStats: modelStatsWithRate,
    latencyDistribution: latencyWithPercent,
    failureReasons: failureWithPercent,
    sourceStats,
  }

  sendSuccess(res, response)
}

async function handleProviderAnalyticsDetail(_req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const { providerId, range } = ProviderAnalyticsRequestSchema.parse(body ?? {})
  const buckets = resolveAnalyticsBuckets(range)
  const { sinceMs } = buckets
  const provider = await getProviderStat(providerId, sinceMs)
  if (!provider) {
    sendError(res, 'RESOURCE_NOT_FOUND', `No provider statistics in the requested time range: ${providerId}`, 404, { providerId })
    return
  }

  const [trend, modelStats, latencyDistribution, failureReasons] = await Promise.all([
    getProviderAnalyticsTrend(providerId, buckets),
    getModelStats(sinceMs, 200, providerId),
    getLatencyDistribution(sinceMs, buckets.latencyTargetBins, providerId),
    getFailureReasons(sinceMs, providerId),
  ])
  const latencySamples = latencyDistribution.reduce((total, bucket) => total + bucket.count, 0)
  const failureSamples = failureReasons.reduce((total, reason) => total + reason.count, 0)
  const response: ProviderAnalyticsDetail = {
    summary: {
      ...provider,
      successRate: provider.attempts > 0 ? provider.success / provider.attempts : 0,
      totalTokens: trend.totalTokens,
    },
    trendIntervalMs: buckets.trendIntervalMs,
    requestTrend: trend.requestTrend,
    tokenTrend: trend.tokenTrend,
    models: modelStats.map(mapModelStat),
    latencyDistribution: latencyDistribution.map(bucket => ({
      ...bucket,
      percent: latencySamples > 0 ? Math.round((bucket.count / latencySamples) * 100) : 0,
    })),
    failureReasons: failureReasons.map(reason => ({
      ...reason,
      percent: failureSamples > 0 ? Math.round((reason.count / failureSamples) * 100) : 0,
    })),
  }
  sendSuccess(res, response)
}

function mapModelStat(model: DatabaseModelStat): ModelStat {
  return {
    providerModelId: model.providerModelId,
    providerModelName: model.providerModelName,
    providerId: model.providerId,
    providerName: model.providerName,
    attempts: model.attempts,
    success: model.success,
    avgLatencyMs: model.avgLatencyMs,
    avgTtftMs: model.avgTtftMs,
    // 输出速度的公式只写在 `@common/metrics` 里，这里只是把同一批尝试的两个合计值送进去。
    // 参数由数据库成对选出：分子是这批尝试的输出 Token，分母是同一批尝试的整段耗时。
    avgTps: tokensPerSecondFromTotals(model.speedOutputTokens, model.speedDurationMs),
    successRate: model.attempts > 0 ? model.success / model.attempts : 0,
    // 缓存读取量本就是输入量的一部分，同口径相除才是命中率。
    cacheHitRate: model.inputTokens > 0 ? model.cachedInputTokens / model.inputTokens : null,
  }
}
