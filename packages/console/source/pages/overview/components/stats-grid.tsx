import { BarChart3, CheckCircle2, Coins, FileOutput } from 'lucide-react'
import type { StatsSummary } from '@common/schemas'
import { averageOutputDisplayParts, averageOutputTokensPerRequest } from '@common/metrics'
import { MetricGrid } from '@/components/metric-grid'
import { NumberTicker } from '@/components/ui/number-ticker'
import { useTranslation } from '@/i18n/provider'

interface StatsGridProps {
  summary: StatsSummary
}

interface AverageOutputTickerProps {
  value: number | null
}

/**
 * 平均输出的动画展示。
 *
 * 数值、小数位都由 `@common/metrics` 的同一套规则给出。没有样本时写 `—`：
 * 没有请求不是「平均输出为零」。
 */
function AverageOutputTicker(props: AverageOutputTickerProps) {
  const parts = averageOutputDisplayParts(props.value)
  if (!parts) return <>—</>
  return <NumberTicker value={parts.value} decimalPlaces={parts.decimalPlaces} />
}

export function StatsGrid(props: StatsGridProps) {
  const { summary } = props
  const t = useTranslation()
  // 分子分母取自同一次聚合：输出总量与请求总数，界面不自己再拼一个合计。
  const averageOutput = averageOutputTokensPerRequest(summary.outputTokens, summary.totalRequests)

  return (
    <MetricGrid items={[
      { label: t('overview.stats.totalRequests'), value: <NumberTicker value={summary.totalRequests} />, Icon: BarChart3 },
      { label: t('overview.stats.successRate'), value: <><NumberTicker value={summary.successRate * 100} decimalPlaces={1} />%</>, Icon: CheckCircle2 },
      { label: t('overview.stats.avgOutput'), value: <AverageOutputTicker value={averageOutput} />, Icon: FileOutput, info: t('overview.stats.avgOutputHint') },
      { label: t('overview.stats.tokenUsage'), value: summary.totalTokens >= 1_000_000 ? <><NumberTicker value={summary.totalTokens / 1_000_000} decimalPlaces={1} />M</> : summary.totalTokens >= 1_000 ? <><NumberTicker value={summary.totalTokens / 1_000} decimalPlaces={1} />K</> : <NumberTicker value={summary.totalTokens} />, Icon: Coins },
    ]} />
  )
}
