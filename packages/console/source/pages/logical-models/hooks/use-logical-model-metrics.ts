import { useLogicalModelMetricsQuery } from '../queries'
import type { ProviderModelMetrics } from '../lib/model-metrics'

/** 数据未就绪时复用的空表，避免 `?? {}` 每次渲染都产生新引用。 */
const EMPTY_MODEL_METRICS: Record<string, ProviderModelMetrics> = {}

export function useLogicalModelMetrics(logicalModelId: string) {
  const query = useLogicalModelMetricsQuery(logicalModelId)
  return { modelMetrics: query.data?.modelMetrics ?? EMPTY_MODEL_METRICS, summaryMetrics: query.data?.summaryMetrics, refresh: query.refetch }
}
