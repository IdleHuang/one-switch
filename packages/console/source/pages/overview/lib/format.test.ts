import { describe, expect, it } from 'vitest'
import { createAppTranslator } from '@common/i18n/catalogs'
import { formatIntervalDescription } from './format'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const t = createAppTranslator('zh-CN')

describe('formatIntervalDescription', () => {
  it('把服务端算出的桶宽翻成粒度文案', () => {
    expect(formatIntervalDescription(t, 5 * MINUTE)).toBe('每 5 分钟用量')
    expect(formatIntervalDescription(t, HOUR)).toBe('每小时用量')
    expect(formatIntervalDescription(t, 6 * HOUR)).toBe('每 6 小时用量')
    expect(formatIntervalDescription(t, DAY)).toBe('每日用量')
  })

  // 桶宽是随响应带回来的字段，界面比服务端新的那段时间里它是 undefined：
  // 以前会算出 `Math.round(undefined / 60000)` 并写出「每 NaN 分钟用量」。
  it('桶宽缺失时不写粒度，也不写出 NaN', () => {
    expect(formatIntervalDescription(t, Number.NaN)).toBeNull()
    expect(formatIntervalDescription(t, undefined as unknown as number)).toBeNull()
    expect(formatIntervalDescription(t, 0)).toBeNull()
  })
})
