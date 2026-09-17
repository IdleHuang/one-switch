import { BarChart3, CheckCircle2, Coins, DatabaseZap } from 'lucide-react'
import type { StatsSummary } from '@common/schemas'
import { MetricGrid } from '@/components/metric-grid'
import { NumberTicker } from '@/components/ui/number-ticker'
import { useTranslation } from '@/i18n/provider'

interface StatsGridProps {
  summary: StatsSummary
}

export function StatsGrid(props: StatsGridProps) {
  const { summary } = props
  const t = useTranslation()
  // 命中率的分子分母由服务端从同一次扫描选出（口径见 `@common/metrics` 的 `cacheHitRate`）。
  // 窗口内没有输入时是 `null`，界面写 `—` 而不是 `0.0%`——「没测到」和「一次都没命中」必须分得开。
  const { cacheHitRate } = summary

  return (
    <MetricGrid items={[
      { label: t('overview.stats.totalRequests'), value: <NumberTicker value={summary.totalRequests} />, Icon: BarChart3 },
      { label: t('overview.stats.successRate'), value: <><NumberTicker value={summary.successRate * 100} decimalPlaces={1} />%</>, Icon: CheckCircle2 },
      { label: t('overview.stats.cacheHitRate'), value: cacheHitRate == null ? <>—</> : <><NumberTicker value={cacheHitRate * 100} decimalPlaces={1} />%</>, Icon: DatabaseZap, info: t('overview.stats.cacheHitRateHint') },
      { label: t('overview.stats.tokenUsage'), value: summary.totalTokens >= 1_000_000 ? <><NumberTicker value={summary.totalTokens / 1_000_000} decimalPlaces={1} />M</> : summary.totalTokens >= 1_000 ? <><NumberTicker value={summary.totalTokens / 1_000} decimalPlaces={1} />K</> : <NumberTicker value={summary.totalTokens} />, Icon: Coins },
    ]} />
  )
}
