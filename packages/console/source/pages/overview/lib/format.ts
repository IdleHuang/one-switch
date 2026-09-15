import { trendIntervalParts } from '@common/analytics-buckets'
import type { AppTranslator } from '@/i18n/provider'

export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`
  return tokens.toString()
}

/** 千分位分隔必须跟随界面语言，不能用运行时默认语言。 */
export function formatCount(locale: string, value: number): string {
  return value.toLocaleString(locale)
}

/**
 * 趋势图的粒度描述。
 *
 * 粒度是服务端从查询范围推出来的并随范围返回，界面不解一遍「今天 / 7 天 / 30 天」：
 * 各处分别推导就一定会有一处忘了改。这里只把桶宽翻成人话。
 *
 * 桶宽缺失时返回 `null`（卡片头就不写这一句）：这个字段是随响应来的，界面比服务端新
 * 的那段时间里它可能没有值，那时说「每 NaN 分钟」比不说更糟。
 */
export function formatTrendDescription(t: AppTranslator, trendIntervalMs: number): string | null {
  const parts = trendIntervalParts(trendIntervalMs)
  if (!parts) return null
  const { unit, count } = parts
  if (unit === 'day') return t('overview.trend.description.daily')
  if (unit === 'hour') return count === 1 ? t('overview.trend.description.hourly') : t('overview.trend.description.everyHour', { count })
  return t('overview.trend.description.everyMinute', { count })
}

export const PROVIDER_COLORS = [
  'bg-emerald-500',
  'bg-orange-500',
  'bg-indigo-500',
  'bg-zinc-700',
  'bg-rose-500',
  'bg-sky-500',
  'bg-amber-500',
  'bg-teal-500',
]

export function getProviderColor(index: number): string {
  return PROVIDER_COLORS[index % PROVIDER_COLORS.length]
}
