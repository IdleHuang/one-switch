import { describe, expect, it } from 'vitest'
import type { ModelTestRoundResult } from '@common/diagnostics'
import { summarizeRounds } from './round-summary'

/**
 * 汇总口径见 `apps/docs/specs/diagnostics.md` §6。这里逐条钉住它：
 * 每一行断言都对应「界面上那一格为什么是这个数」。
 */

function round(overrides: Partial<ModelTestRoundResult>): ModelTestRoundResult {
  return { round: 1, success: true, durationMilliseconds: 100, ...overrides }
}

describe('diagnostic round summary', () => {
  it('全过才算成功：跑三轮挂一轮仍然要红', () => {
    const summary = summarizeRounds([
      round({ round: 1 }),
      round({ round: 2, success: false, statusCode: 500, errorMessage: 'boom' }),
      round({ round: 3 }),
    ])
    expect(summary.success).toBe(false)
    expect(summary.errorMessage).toBe('boom')
  })

  it('状态码取第一个失败轮的，而不是最后一轮碰巧的 200', () => {
    const summary = summarizeRounds([
      round({ round: 1, success: false, statusCode: 429 }),
      round({ round: 2, statusCode: 200 }),
    ])
    expect(summary.statusCode).toBe(429)
  })

  it('全过时状态码取最后一轮', () => {
    expect(summarizeRounds([round({ round: 1 }), round({ round: 2, statusCode: 204 })]).statusCode).toBe(204)
  })

  it('耗时取各轮均值并取整，不给界面留小数', () => {
    const summary = summarizeRounds([round({ round: 1, durationMilliseconds: 100 }), round({ round: 2, durationMilliseconds: 151 })])
    expect(summary.durationMilliseconds).toBe(126)
  })

  it('Token 与 TTFT 只对报过数的轮次取均值', () => {
    const summary = summarizeRounds([
      round({ round: 1, inputTokens: 10, outputTokens: null, ttftMilliseconds: null }),
      round({ round: 2, inputTokens: 20, outputTokens: 400, ttftMilliseconds: 100 }),
    ])
    // 没报的轮次不参与分母：把它当 0 会把「不知道」混进「很快」。
    expect(summary.inputTokens).toBe(15)
    expect(summary.outputTokens).toBe(400)
    expect(summary.ttftMilliseconds).toBe(100)
  })

  it('一轮都没报出某个数时给 null，不是 0', () => {
    const summary = summarizeRounds([round({ round: 1 })])
    expect(summary.inputTokens).toBeNull()
    expect(summary.outputTokens).toBeNull()
    expect(summary.ttftMilliseconds).toBeNull()
    expect(summary.tokensPerSecond).toBeNull()
  })

  it('速度保留两位小数：均值会给出界面上毫无意义的精度', () => {
    const summary = summarizeRounds([
      round({ round: 1, tokensPerSecond: 12.3456789 }),
      round({ round: 2, tokensPerSecond: 12 }),
    ])
    expect(summary.tokensPerSecond).toBe(12.17)
  })

  it('把明细原样带上，界面展开就能看到每一轮', () => {
    const rounds = [round({ round: 1 }), round({ round: 2 })]
    expect(summarizeRounds(rounds).rounds).toBe(rounds)
  })
})
