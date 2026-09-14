import type { RequestLogEntry } from '@common/schemas'
import { averageOutputTokensPerSecond, outputSpeedSampleOf, type OutputSpeedSample } from '@common/metrics'

export interface ProviderModelMetrics {
  sampleCount: number
  avgTps: number | null
  avgTtftMilliseconds: number | null
}

export interface LogicalModelSummaryMetrics {
  completedRequestCount: number
  successCount: number
  successRate: number | null
  avgDurationMilliseconds: number | null
  avgTps: number | null
  failoverCount: number
}

interface MetricAccumulator {
  requestIds: Set<string>
  speedSamples: OutputSpeedSample[]
  ttftTotal: number
  ttftCount: number
}

export function providerModelMetricKey(providerId: string, providerModelId: string): string {
  return `${providerId}\0${providerModelId}`
}

export function calculateLogicalModelSummaryMetrics(logs: RequestLogEntry[]): LogicalModelSummaryMetrics {
  const completedLogs = logs.filter(log => log.status === 'success' || log.status === 'failed' || log.status === 'cancelled')
  const successfulLogs = completedLogs.filter(log => log.status === 'success')
  // 平均耗时与平均速度取自**同一批样本**：样本的耗时是「服务该请求的那次尝试」的端到端耗时，
  // 没有尝试可用时才退回请求级总耗时——这条回落规则由 `@common/metrics` 定义，这里不重写一份。
  const speedSamples = successfulLogs.map(outputSpeedSampleOf)
  const durations = speedSamples.map(sample => sample.attemptDurationMilliseconds).filter(duration => duration > 0)

  return {
    completedRequestCount: completedLogs.length,
    successCount: successfulLogs.length,
    successRate: completedLogs.length > 0 ? successfulLogs.length / completedLogs.length : null,
    avgDurationMilliseconds: durations.length > 0 ? durations.reduce((total, duration) => total + duration, 0) / durations.length : null,
    // 平均速度由 `@common/metrics` 用「先求和再相除」算出：先算每个请求的速度再取算术平均
    // 会让 20 Token 的短响应与 4000 Token 的长响应一样重，均值被短样本主导。
    avgTps: averageOutputTokensPerSecond(speedSamples),
    failoverCount: successfulLogs.filter(log => log.attempts.some(attempt => attempt.status === 'success' && attempt.attemptIndex > 0)).length,
  }
}

export function calculateProviderModelMetrics(logs: RequestLogEntry[]): Record<string, ProviderModelMetrics> {
  const accumulators = new Map<string, MetricAccumulator>()

  for (const log of logs) {
    if (log.status !== 'success') continue
    const successfulAttempt = log.attempts.find(attempt => attempt.status === 'success')
    if (!successfulAttempt) continue

    const key = providerModelMetricKey(successfulAttempt.providerId, successfulAttempt.providerModelId)
    const accumulator = accumulators.get(key) ?? {
      requestIds: new Set<string>(),
      speedSamples: [],
      ttftTotal: 0,
      ttftCount: 0,
    }
    accumulator.requestIds.add(log.id)

    // TTFT 是尝试级样本：必须取真正成功那次尝试的值，而不是请求级派生值。
    if (successfulAttempt.ttftMilliseconds != null) {
      accumulator.ttftTotal += successfulAttempt.ttftMilliseconds
      accumulator.ttftCount += 1
    }

    // 速度样本与首字延迟取自同一次尝试，同一个模型行上的两个指标才不会错位。
    // 分子是请求级输出 Token（它本来就是这次尝试镜像过来的一份），分母是这次尝试的整段耗时。
    accumulator.speedSamples.push({
      outputTokens: log.outputTokens,
      attemptDurationMilliseconds: successfulAttempt.durationMilliseconds,
    })

    accumulators.set(key, accumulator)
  }

  return Object.fromEntries(Array.from(accumulators, ([key, accumulator]) => [key, {
    sampleCount: accumulator.requestIds.size,
    avgTps: averageOutputTokensPerSecond(accumulator.speedSamples),
    avgTtftMilliseconds: accumulator.ttftCount > 0 ? accumulator.ttftTotal / accumulator.ttftCount : null,
  }]))
}
