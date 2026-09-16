import { describe, expect, it } from 'vitest'
import {
  DAY_MILLISECONDS,
  HEAT_TARGET_CELLS,
  formatDuration,
  formatLatencyBinLabel,
  formatLatencyBinTick,
  formatTrendBucketLabel,
  formatTrendTickLabel,
  formatTrendTooltipLabel,
  resolveAnalyticsBuckets,
  resolveHeatBuckets,
  resolveHeatBucketCount,
  resolveHeatIntervalMs,
  resolveLatencyBinEdges,
  resolveRangeSpanMs,
  resolveTrendBuckets,
  resolveTrendIntervalMs,
  resolveTrendTicks,
  resolveUsageHeatLevels,
  startOfLocalDay,
  trendBucketIndexAt,
  trendBucketLabelAt,
  trendCrossesDays,
  trendIntervalParts,
} from './analytics-buckets'

const MINUTE = 60_000
const HOUR = 60 * MINUTE

/** 固定到一个本地时刻，断言因此与运行时区无关。 */
function localTime(hours: number, minutes = 0): number {
  return new Date(2026, 8, 9, hours, minutes, 0, 0).getTime()
}

describe('resolveTrendIntervalMs', () => {
  const anchor = startOfLocalDay(localTime(0))
  const intervalAt = (nowHour: number, nowMinute = 0) => resolveTrendIntervalMs(anchor, anchor, localTime(nowHour, nowMinute))

  it('今天的粒度随时间推移自动变粗', () => {
    expect(intervalAt(0, 30)).toBe(5 * MINUTE)
    expect(intervalAt(3)).toBe(5 * MINUTE)
    expect(intervalAt(6, 30)).toBe(10 * MINUTE)
    expect(intervalAt(12)).toBe(15 * MINUTE)
    expect(intervalAt(15)).toBe(30 * MINUTE)
    expect(intervalAt(23, 59)).toBe(30 * MINUTE)
  })

  it('窗口越长步长越粗', () => {
    const since7d = localTime(15) - 7 * DAY_MILLISECONDS
    const since30d = localTime(15) - 30 * DAY_MILLISECONDS
    // 两端各有一个不完整的桶，桶数因此比「跨度 ÷ 步长」多一个；
    // 7 天落在 3 小时（57 根）——一天一根看不出一天之内的起落，也没必要一路细到 1 小时。
    expect(resolveTrendIntervalMs(startOfLocalDay(since7d), since7d, localTime(15))).toBe(3 * HOUR)
    expect(resolveTrendIntervalMs(startOfLocalDay(since30d), since30d, localTime(15))).toBe(DAY_MILLISECONDS)
  })

  it('任何步长都整除一天，桶边界因此落在本地整点上', () => {
    for (let hours = 1; hours <= 24 * 31; hours++) {
      const now = localTime(0) + hours * HOUR
      expect(DAY_MILLISECONDS % resolveTrendIntervalMs(startOfLocalDay(localTime(0)), localTime(0), now)).toBe(0)
    }
  })
})

describe('trendBucketIndexAt', () => {
  const anchor = startOfLocalDay(localTime(0))

  it('桶号按墙钟分钟数递增，与绝对毫秒对齐的桶一致', () => {
    expect(trendBucketIndexAt(anchor, localTime(0), HOUR)).toBe(0)
    expect(trendBucketIndexAt(anchor, localTime(6), HOUR)).toBe(6)
    expect(trendBucketIndexAt(anchor, localTime(23, 59), HOUR)).toBe(23)
    // 跨到第二天，桶号继续往下数而不是回到 0。
    expect(trendBucketIndexAt(anchor, localTime(0) + DAY_MILLISECONDS + 3 * HOUR, HOUR)).toBe(27)
    expect(trendBucketIndexAt(anchor, localTime(6), 6 * HOUR)).toBe(1)
  })
})

describe('resolveLatencyBinEdges', () => {
  it('桶宽取能装下 p95 的最细一档', () => {
    // 200ms 的 p95 装进 5 档：50ms 一档（25ms 要 8 档）。
    expect(resolveLatencyBinEdges(200, 6)).toEqual([50, 100, 150, 200, 250])
    // 1.5s 的 p95：200ms 要 8 档，超出 7 档预算，退到 250ms。
    expect(resolveLatencyBinEdges(1500, 8)).toEqual([250, 500, 750, 1000, 1250, 1500, 1750])
  })

  it('边界从 0 起，且比 p95 多排一格留给慢尾', () => {
    const edges = resolveLatencyBinEdges(3050, 10)
    expect(edges).toEqual([500, 1000, 1500, 2000, 2500, 3000, 3500, 4000])
    // p95 落在倒数第二档之内，不会因为正好压在边界上而让那 5% 全挤进开口桶。
    expect(edges[edges.length - 2]).toBeGreaterThanOrEqual(3050)
  })

  it('样本全挤在一起时也留得下两个刻度', () => {
    expect(resolveLatencyBinEdges(0, 8)).toEqual([1])
    expect(resolveLatencyBinEdges(120000, 10)).toEqual([20000, 40000, 60000, 80000, 100000, 120000, 140000])
  })

  it('档位标签覆盖左闭右开的每一档与溢出桶', () => {
    const edges = resolveLatencyBinEdges(200, 6)
    expect(formatLatencyBinLabel(edges, 0)).toBe('< 50ms')
    expect(formatLatencyBinLabel(edges, 1)).toBe('50ms-100ms')
    expect(formatLatencyBinLabel(edges, edges.length)).toBe('>= 250ms')
    expect(formatLatencyBinLabel(resolveLatencyBinEdges(1500, 8), 1)).toBe('250ms-500ms')
  })

  it('横轴刻度只写上界，开口的那一档用 + 标出', () => {
    expect(formatLatencyBinTick('< 50ms')).toBe('50ms')
    expect(formatLatencyBinTick('50ms-100ms')).toBe('100ms')
    expect(formatLatencyBinTick('1s-1.5s')).toBe('1.5s')
    expect(formatLatencyBinTick('>= 2s')).toBe('2s+')
  })

  it('区间端点不写尾随小数位，秒以上才换单位', () => {
    expect(formatDuration(50)).toBe('50ms')
    expect(formatDuration(1000)).toBe('1s')
    expect(formatDuration(2500)).toBe('2.5s')
  })
})

describe('trendIntervalParts', () => {
  it('把桶宽说成人话', () => {
    expect(trendIntervalParts(5 * MINUTE)).toEqual({ unit: 'minute', count: 5 })
    expect(trendIntervalParts(6 * HOUR)).toEqual({ unit: 'hour', count: 6 })
    expect(trendIntervalParts(HOUR)).toEqual({ unit: 'hour', count: 1 })
    expect(trendIntervalParts(DAY_MILLISECONDS)).toEqual({ unit: 'day', count: 1 })
  })

  it('桶宽缺失或不是正数时不给分解，免得写出「每 NaN 分钟」', () => {
    expect(trendIntervalParts(Number.NaN)).toBeNull()
    expect(trendIntervalParts(0)).toBeNull()
    expect(trendIntervalParts(-MINUTE)).toBeNull()
  })
})

describe('resolveAnalyticsBuckets', () => {
  const nowMs = localTime(15)

  it('今天从本地零点起算，粒度随当天时间推移变粗', () => {
    const buckets = resolveAnalyticsBuckets('today', nowMs)
    expect(buckets.sinceMs).toBe(localTime(0))
    expect(buckets.trendIntervalMs).toBe(30 * MINUTE)
    expect(buckets.trendAnchorDayMs).toBe(localTime(0))
    expect(buckets.trendBucketCount).toBe(31)
    expect(buckets.latencyTargetBins).toBe(16)
  })

  it('7 天与 30 天各自落在一档更粗的粒度上', () => {
    const week = resolveAnalyticsBuckets('7d', nowMs)
    expect(week.sinceMs).toBe(nowMs - 7 * DAY_MILLISECONDS)
    expect(week.trendIntervalMs).toBe(3 * HOUR)
    expect(week.trendBucketCount).toBe(57)

    const month = resolveAnalyticsBuckets('30d', nowMs)
    expect(month.sinceMs).toBe(nowMs - 30 * DAY_MILLISECONDS)
    expect(month.trendIntervalMs).toBe(DAY_MILLISECONDS)
    expect(month.trendBucketCount).toBe(31)
  })

  it('热力图的粒度比趋势图细，且三个范围铺出来的格数都在同一个量级', () => {
    const today = resolveAnalyticsBuckets('today', nowMs)
    expect(today.heatIntervalMs).toBe(10 * MINUTE)
    expect(today.heatBucketCount).toBe(144)

    const week = resolveAnalyticsBuckets('7d', nowMs)
    expect(week.heatIntervalMs).toBe(HOUR)
    expect(week.heatBucketCount).toBe(169)

    const month = resolveAnalyticsBuckets('30d', nowMs)
    expect(month.heatIntervalMs).toBe(4 * HOUR)
    expect(month.heatBucketCount).toBe(181)
  })

  it('桶清单覆盖整个窗口且标签与桶号一一对应', () => {
    const buckets = resolveAnalyticsBuckets('today', nowMs)
    const slots = resolveTrendBuckets(buckets)
    expect(slots).toHaveLength(buckets.trendBucketCount)
    expect(slots[0]).toEqual({ index: 0, label: '2026-09-09 00:00' })
    expect(slots[slots.length - 1]).toEqual({ index: 30, label: '2026-09-09 15:00' })
  })
})

describe('resolveRangeSpanMs', () => {
  it('三个范围的名义时长各是一整天 / 7 天 / 30 天', () => {
    expect(resolveRangeSpanMs('today')).toBe(DAY_MILLISECONDS)
    expect(resolveRangeSpanMs('7d')).toBe(7 * DAY_MILLISECONDS)
    expect(resolveRangeSpanMs('30d')).toBe(30 * DAY_MILLISECONDS)
  })
})

describe('resolveHeatIntervalMs', () => {
  it('按完整时长挑格宽，三个范围各落一档', () => {
    expect(resolveHeatIntervalMs(DAY_MILLISECONDS)).toBe(10 * MINUTE)
    expect(resolveHeatIntervalMs(7 * DAY_MILLISECONDS)).toBe(HOUR)
    expect(resolveHeatIntervalMs(30 * DAY_MILLISECONDS)).toBe(4 * HOUR)
  })

  it('任何范围都不超格数上限，且格宽定为最细的那一档', () => {
    // 「最细」看的是下一档：比它细一档就超上限了，否则格数还可以再小一轮。
    const steps = [5, 10, 15, 30, 60, 120, 180, 240, 360, 480, 720, 1440]
    for (const days of [1, 7, 30]) {
      const spanMs = days * DAY_MILLISECONDS
      const intervalMs = resolveHeatIntervalMs(spanMs)
      expect(Math.ceil(spanMs / intervalMs)).toBeLessThanOrEqual(HEAT_TARGET_CELLS)
      const finer = steps[steps.indexOf(intervalMs / MINUTE) - 1]
      expect(Math.ceil(spanMs / (finer * MINUTE))).toBeGreaterThan(HEAT_TARGET_CELLS)
    }
  })

  it('格宽都整除一天，格子边界因此落在本地整点上', () => {
    for (const days of [1, 7, 30]) {
      expect(DAY_MILLISECONDS % resolveHeatIntervalMs(days * DAY_MILLISECONDS)).toBe(0)
    }
  })
})

describe('resolveHeatBuckets', () => {
  const nowMs = localTime(15)

  it('今天的格子铺满一整天，后半天就是空格子', () => {
    const buckets = resolveAnalyticsBuckets('today', nowMs)
    const slots = resolveHeatBuckets(buckets)
    expect(slots).toHaveLength(144)
    expect(slots[0]).toEqual({ index: 0, label: '2026-09-09 00:00' })
    expect(slots[143]).toEqual({ index: 143, label: '2026-09-09 23:50' })
  })

  it('7 天与 30 天的格子从此刻往前铺满完整时长', () => {
    const week = resolveAnalyticsBuckets('7d', nowMs)
    const weekSlots = resolveHeatBuckets(week)
    expect(weekSlots[0].label).toBe('2026-09-02 15:00')
    expect(weekSlots[weekSlots.length - 1].label).toBe('2026-09-09 15:00')
    // 首尾各占一个不完整的桶，所以格数比「跨度 ÷ 格宽」多一个。
    expect((weekSlots.length - 1) * week.heatIntervalMs).toBe(resolveRangeSpanMs('7d'))

    const month = resolveAnalyticsBuckets('30d', nowMs)
    const monthSlots = resolveHeatBuckets(month)
    // 4 小时一格的网格不会落在 15:00 上：首格对齐到 12:00，末格是含「此刻」的那一格。
    expect(monthSlots[0].label).toBe('2026-08-10 12:00')
    expect(monthSlots[monthSlots.length - 1].label).toBe('2026-09-09 12:00')
    expect((monthSlots.length - 1) * month.heatIntervalMs).toBe(resolveRangeSpanMs('30d'))
  })

  it('格号与格宽一致，且相邻两格的标签不重不漏', () => {
    const buckets = resolveAnalyticsBuckets('today', nowMs)
    const slots = resolveHeatBuckets(buckets)
    expect(slots.map(slot => slot.index)).toEqual(Array.from({ length: 144 }, (_, index) => index))
    expect(new Set(slots.map(slot => slot.label)).size).toBe(144)
  })

  it('恰好遇到已经走过的格时取两者里更大的格数，不会把已有数据的格漏掉', () => {
    const anchor = startOfLocalDay(nowMs)
    // 时钟被往前调过（此刻落在规划终点之后）：按已经走过的格算，而不是按名义时长截断。
    const elapsed = 200
    expect(resolveHeatBucketCount(anchor, anchor, anchor + elapsed * 10 * MINUTE, 10 * MINUTE, DAY_MILLISECONDS)).toBe(elapsed + 1)
    // 正常情况：今日永远是整天的格数，与时刻无关。
    expect(resolveHeatBucketCount(anchor, anchor, localTime(6), 10 * MINUTE, DAY_MILLISECONDS)).toBe(144)
  })
})

describe('趋势标签', () => {
  const morning = localTime(6)

  it('日内桶写日期加时刻，整天桶只写日期', () => {
    expect(formatTrendBucketLabel(morning, 6 * HOUR)).toBe('2026-09-09 06:00')
    expect(formatTrendBucketLabel(morning, DAY_MILLISECONDS)).toBe('2026-09-09')
    expect(trendBucketLabelAt(startOfLocalDay(morning), 3, DAY_MILLISECONDS)).toBe('2026-09-12')
  })

  it('同一天内只写时刻，跨天时日期只写在各天的第一格上', () => {
    expect(formatTrendTickLabel('en', '2026-09-09 06:00', false)).toBe('06:00')
    expect(formatTrendTickLabel('en', '2026-09-09 00:00', false)).toBe('00:00')
    expect(formatTrendTickLabel('en', '2026-09-09 06:00', true)).toBe('06:00')
    expect(formatTrendTickLabel('en', '2026-09-09 00:00', true)).toBe('9/9')
    expect(formatTrendTickLabel('en', '2026-09-09', true)).toBe('9/9')
  })

  it('Tooltip 跨天时带上日期与星期，同日只写时刻', () => {
    expect(formatTrendTooltipLabel('en', '2026-09-09 06:00', false)).toBe('06:00')
    expect(formatTrendTooltipLabel('en', '2026-09-09 06:00', true)).toContain('September 9')
    expect(formatTrendTooltipLabel('en', '2026-09-09 06:00', true)).toContain('06:00')
    expect(formatTrendTooltipLabel('en', '2026-09-09', true)).toBe('September 9')
  })

  it('首尾标签落在同一个日期上就不算跨天', () => {
    expect(trendCrossesDays([])).toBe(false)
    expect(trendCrossesDays(['2026-09-09 00:00', '2026-09-09 06:00'])).toBe(false)
    expect(trendCrossesDays(['2026-09-09 06:00', '2026-09-10 00:00'])).toBe(true)
  })

  // 标签是跨进程的显示数据：界面比服务端新时（服务端还在发旧版的 `HH:MM`）
  // 以前会在 `Intl.DateTimeFormat.format(NaN)` 上抛 `RangeError: Invalid time value`，
  // 一个标签格式就把整张图带崩。认不出就照原样写，是这张图唯一允许的降级方式。
  it('认不出的标签照原样写出来，不抛异常', () => {
    expect(formatTrendTickLabel('zh-CN', '00:15', false)).toBe('00:15')
    expect(formatTrendTickLabel('zh-CN', '00:15', true)).toBe('00:15')
    expect(formatTrendTooltipLabel('zh-CN', '00:15', true)).toBe('00:15')
    expect(formatTrendTickLabel('zh-CN', '', true)).toBe('')
    expect(formatTrendTooltipLabel('zh-CN', '2026-09-09T06:00', true)).toBe('2026-09-09T06:00')
    expect(formatTrendTickLabel('zh-CN', '9/9', true)).toBe('9/9')
  })
})

/** 从某个零点起，自 `firstIndex` 号桶开始铺 `count` 个标签，用来喂刻度挑选。 */
function labelsFrom(anchorDayMs: number, firstIndex: number, count: number, intervalMs: number): string[] {
  return Array.from({ length: count }, (_, offset) => trendBucketLabelAt(anchorDayMs, firstIndex + offset, intervalMs))
}

describe('resolveTrendTicks', () => {
  const anchor = localTime(0)
  /** 刻度值要到坐标轴上显示成什么，跟前端走的是同一条路子。 */
  const display = (labels: string[], count = 16) => resolveTrendTicks(labels, count).map(label => formatTrendTickLabel('en', label, trendCrossesDays(labels)))

  it('柱子是 3 小时时挑 12 小时一格，日期只落在零点那格', () => {
    // 窗口从 06:00 起（查询「近 7 天」就是这种起点），57 根柱子铺满一周。
    const ticks = display(labelsFrom(anchor, 2, 57, 3 * HOUR))
    // 开头那个 12:00 前面没有日期认领，掐掉；刻度值本身是桶标签，用 recharts 的 tickFormatter 再写成人看的字。
    expect(ticks.slice(0, 4)).toEqual(['9/10', '12:00', '9/11', '12:00'])
    expect(ticks.length).toBe(13)
  })

  it('柱子是 15 分钟时挑整点刻度，同一天内不写日期', () => {
    const ticks = display(labelsFrom(anchor, 0, 31, 15 * MINUTE))
    expect(ticks).toEqual(['00:00', '01:00', '02:00', '03:00', '04:00', '05:00', '06:00', '07:00'])
  })

  it('柱子是一天一根时挑两天一格，只写日期', () => {
    const ticks = display(labelsFrom(anchor, 0, 31, DAY_MILLISECONDS))
    expect(ticks.slice(0, 3)).toEqual(['9/9', '9/11', '9/13'])
    expect(ticks.length).toBe(16)
  })

  it('刻度值就是桶标签本身，否则 recharts 一个也对不上', () => {
    const labels = labelsFrom(anchor, 0, 31, DAY_MILLISECONDS)
    resolveTrendTicks(labels, 16).forEach(tick => expect(labels).toContain(tick))
  })

  it('标签认不出来时退回等间隔抽取，数量不超上限', () => {
    const labels = Array.from({ length: 29 }, (_, index) => `${pad2(Math.floor(index / 2))}:${index % 2 === 0 ? '00' : '30'}`)
    const ticks = resolveTrendTicks(labels, 16)
    expect(ticks[0]).toBe('00:00')
    expect(ticks.length).toBeLessThanOrEqual(16)
  })
})

describe('resolveUsageHeatLevels（用量分布的档位）', () => {
  /** 真实场景是 144 ~ 181 个桶，这里按 180 铺，末尾用零桶把长度补齐。 */
  function buildValues(buckets: number[]): number[] {
    return [...buckets, ...Array.from({ length: 180 - buckets.length }, () => 0)]
  }

  it('全是零桶时整张图都是 0 档', () => {
    const levelOf = resolveUsageHeatLevels(buildValues([]))
    expect(levelOf(0)).toBe(0)
    expect(levelOf(1)).toBe(0)
  })

  it('零桶永远是 0 档，哪怕分位数把它夹在中间', () => {
    const levelOf = resolveUsageHeatLevels(buildValues([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))
    expect(levelOf(0)).toBe(0)
  })

  it('档位按非零桶的分位数切，四档都有人', () => {
    // 十个桶的用量 1~10：p25 = 3、p50 = 6、p75 = 8，切出来 3/3/2/2 个桶。
    const levelOf = resolveUsageHeatLevels(buildValues([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(levelOf)).toEqual([1, 1, 1, 2, 2, 2, 3, 3, 4, 4])
    expect(new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(levelOf))).toEqual(new Set([1, 2, 3, 4]))
  })

  it('重尾分布下不会只剩一个深格子', () => {
    // 某个桶撞上一次超长上下文（100 倍于平时），其余 29 个桶用量相近。
    const ordinary = Array.from({ length: 29 }, (_, index) => 100 + index)
    const levelOf = resolveUsageHeatLevels(buildValues([...ordinary, 10_000]))
    expect(new Set(ordinary.map(levelOf)).size).toBeGreaterThan(1)
    expect(levelOf(10_000)).toBe(4)
  })

  it('非零桶不足四档时退回按最大值等分', () => {
    const levelOf = resolveUsageHeatLevels(buildValues([1, 50, 100]))
    expect(levelOf(1)).toBe(1)
    expect(levelOf(50)).toBe(2)
    expect(levelOf(100)).toBe(4)
  })

  it('非零桶全都一样时统一给中间档，不涂成满格', () => {
    // 刚装上、每个窗口一两条请求就是这种形状：涂成最深一档读起来像「满负荷跑了一整天」。
    const levelOf = resolveUsageHeatLevels(buildValues([7, 7, 7]))
    expect(levelOf(7)).toBe(2)
    expect(levelOf(6)).toBe(2)
    expect(levelOf(0)).toBe(0)
  })

  it('档位是纯函数：同一份数据算两次给同一个结果', () => {
    const values = buildValues([3, 9, 27, 81, 243])
    const first = resolveUsageHeatLevels(values)
    const second = resolveUsageHeatLevels(values)
    expect(values.map(first)).toEqual(values.map(second))
  })
})

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}
