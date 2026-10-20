import { describe, expect, it } from 'vitest'
import { StreamProbeResponse, readUsage } from './probe-response'

/**
 * 从响应里读两样东西：用量与首字时刻。
 *
 * 两条口径都在这里钉死：读不到就是 `null`（不是 0），首字认的是**第一段真实内容**
 * 而不是第一块字节。二者都是「界面上那一格该显示什么」的定义。
 */
describe('diagnostic usage parsing', () => {
  it('认得 OpenAI、Responses 与 Anthropic 三套字段名', () => {
    expect(readUsage('{"usage":{"prompt_tokens":12,"completion_tokens":7}}')).toEqual({ inputTokens: 12, outputTokens: 7 })
    expect(readUsage('{"usage":{"input_tokens":12,"output_tokens":7}}')).toEqual({ inputTokens: 12, outputTokens: 7 })
  })

  it('同一个 usage 里混着占位 0 与真实值时要取真实值', () => {
    // 与 observers/usage.ts 同口径：Chat 风格字段是占位 0 时不能盖住 Responses 风格的真实值。
    const body = '{"usage":{"prompt_tokens":0,"completion_tokens":0,"input_tokens":38829,"output_tokens":477}}'
    expect(readUsage(body)).toEqual({ inputTokens: 38829, outputTokens: 477 })
  })

  it('读不到用量时返回 null，界面才好用 — 占位', () => {
    expect(readUsage('{"choices":[]}')).toEqual({ inputTokens: null, outputTokens: null })
    expect(readUsage('not json')).toEqual({ inputTokens: null, outputTokens: null })
    expect(readUsage('{"usage":{"prompt_tokens":"12"}}')).toEqual({ inputTokens: null, outputTokens: null })
  })
})

describe('diagnostic stream probe', () => {
  it('首字认的是真实内容，不是第一帧', () => {
    const startedAt = Date.now()
    const probe = new StreamProbeResponse()
    // 起始帧只报角色、收尾帧只报用量，都不是用户看到的字；按字节打点会让首字虚低。
    probe.write('data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n')
    expect(probe.firstOutputElapsed(startedAt)).toBeNull()
    probe.write('data: {"choices":[{"delta":{"content":"1"}}]}\n\n')
    expect(probe.firstOutputElapsed(startedAt)).not.toBeNull()
  })

  it('首字只记一次：后面每个字都往后推就变成「末字」了', () => {
    const startedAt = Date.now()
    const probe = new StreamProbeResponse()
    probe.write('data: {"choices":[{"delta":{"content":"1"}}]}\n\n')
    const first = probe.firstOutputElapsed(startedAt)
    probe.write('data: {"choices":[{"delta":{"content":"2"}}]}\n\n')
    expect(probe.firstOutputElapsed(startedAt)).toBe(first)
  })

  it('上游一个内容都没给时首字是 null，不是 0', () => {
    const probe = new StreamProbeResponse()
    probe.write('data: [DONE]\n\n')
    expect(probe.firstOutputElapsed(Date.now())).toBeNull()
    expect(probe.usage()).toEqual({ inputTokens: null, outputTokens: null })
  })

  it('用量从流里读，并且认得被切开的半截帧', () => {
    const probe = new StreamProbeResponse()
    probe.write('data: {"usage":{"prompt_tokens":12,')
    probe.write('"completion_tokens":7}}\n\n')
    probe.write('data: [DONE]\n\n')
    expect(probe.usage()).toEqual({ inputTokens: 12, outputTokens: 7 })
  })
})
