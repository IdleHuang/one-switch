import { describe, expect, it } from 'vitest'
import type { RequestLogEntry } from './schemas'
import {
  averageOutputTokensPerSecond,
  formatMilliseconds,
  formatOutputSpeed,
  generationDurationMilliseconds,
  millisecondsDisplayParts,
  outputSpeedDecimalPlaces,
  outputSpeedSampleOf,
  outputTokensPerSecond,
  requestOutputTokensPerSecond,
  servingAttemptOf,
  tokensPerSecondFromTotals,
} from './metrics'

interface LogOverrides {
  outputTokens?: number | null
  totalDurationMilliseconds?: number
  ttftMilliseconds?: number | null
  attempts?: Array<{ durationMilliseconds: number; ttftMilliseconds: number | null }>
}

function logOf(overrides: LogOverrides = {}): RequestLogEntry {
  return {
    id: 'req_test',
    logicalModelId: 'default',
    clientProtocol: 'openai-responses',
    transport: 'http-stream',
    status: 'success',
    totalDurationMilliseconds: overrides.totalDurationMilliseconds ?? 0,
    totalTokens: null,
    inputTokens: null,
    reasoningTokens: null,
    outputTokens: overrides.outputTokens ?? null,
    cachedInputTokens: null,
    cacheCreationInputTokens: null,
    promptCacheHit: null,
    rawUsage: null,
    ttftMilliseconds: overrides.ttftMilliseconds ?? null,
    createdTime: 0,
    attempts: (overrides.attempts ?? []).map((attempt, index) => ({
      id: `att_test_${index}`,
      attemptIndex: index,
      status: 'success',
      providerId: 'prov_test',
      providerName: 'Provider Test',
      providerModelId: 'model_test',
      providerModelName: 'model-test',
      upstreamProtocol: 'openai-responses',
      upstreamRequestId: null,
      url: 'https://example.com/v1/responses',
      httpStatus: 200,
      retryable: false,
      upstreamTransport: 'http-stream',
      ttftMilliseconds: attempt.ttftMilliseconds,
      requestRewriteRuleIds: [],
      responseRewriteRuleIds: [],
      errorCode: null,
      errorMessage: null,
      durationMilliseconds: attempt.durationMilliseconds,
      createdTime: 0,
    })),
  }
}

describe('generation duration', () => {
  it('subtracts the first-token wait from the attempt duration', () => {
    expect(generationDurationMilliseconds(2000, 500)).toBe(1500)
  })

  it('treats a missing first-token wait as no wait at all', () => {
    // 整包响应没有「首字」这个时刻，整段耗时都在产出内容。
    expect(generationDurationMilliseconds(2000, null)).toBe(2000)
  })

  it('never goes negative when the wait overshoots the whole attempt', () => {
    expect(generationDurationMilliseconds(500, 900)).toBe(0)
  })
})

describe('tokens per second', () => {
  it('divides output tokens by the generation window in seconds', () => {
    expect(tokensPerSecondFromTotals(1500, 1500)).toBe(1000)
    expect(tokensPerSecondFromTotals(120, 5000)).toBe(24)
  })

  it('reports no speed when the generation window is not positive', () => {
    // 这不是「极快」，是没有速度。曾经的口径把这种请求算成天文数字，就是这个 bug 的来源。
    expect(tokensPerSecondFromTotals(100, 0)).toBeNull()
    expect(tokensPerSecondFromTotals(100, -400)).toBeNull()
  })

  it('reports no speed when nothing was generated', () => {
    expect(tokensPerSecondFromTotals(0, 5000)).toBeNull()
    expect(tokensPerSecondFromTotals(-1, 5000)).toBeNull()
  })
})

describe('per-attempt output speed', () => {
  it('measures against the generation window, not the whole attempt', () => {
    // 20 Token /（2000 - 500）ms = 13.33…
    expect(outputTokensPerSecond({ outputTokens: 20, attemptDurationMilliseconds: 2000, ttftMilliseconds: 500 })).toBeCloseTo(13.333, 3)
  })

  it('uses the whole attempt when there was no first-token wait', () => {
    expect(outputTokensPerSecond({ outputTokens: 20, attemptDurationMilliseconds: 2000, ttftMilliseconds: null })).toBeCloseTo(10, 6)
  })

  it('reports no speed when the first token ate the whole attempt', () => {
    expect(outputTokensPerSecond({ outputTokens: 427, attemptDurationMilliseconds: 483, ttftMilliseconds: 483 })).toBeNull()
    expect(outputTokensPerSecond({ outputTokens: 427, attemptDurationMilliseconds: 483, ttftMilliseconds: 500 })).toBeNull()
  })

  it('reports no speed when the request has no token count', () => {
    expect(outputTokensPerSecond({ outputTokens: null, attemptDurationMilliseconds: 2000, ttftMilliseconds: null })).toBeNull()
  })
})

describe('average output speed', () => {
  it('adds tokens and windows first, then divides once', () => {
    // 两条样本各自的单请求速度是 1000 与 200，算术平均会得到 600。
    // 但快的那条只产出 10 个 Token，慢的那条产出了 5000 个：代价要按 Token 加权。
    const fast = { outputTokens: 10, attemptDurationMilliseconds: 10, ttftMilliseconds: null }
    const slow = { outputTokens: 5000, attemptDurationMilliseconds: 25_000, ttftMilliseconds: null }
    expect(outputTokensPerSecond(fast)).toBe(1000)
    expect(outputTokensPerSecond(slow)).toBe(200)
    expect(averageOutputTokensPerSecond([fast, slow])).toBeCloseTo(5010 / 25.01, 6)
  })

  it('skips samples that have no speed of their own, in the numerator and the denominator alike', () => {
    const samples = [
      { outputTokens: 20, attemptDurationMilliseconds: 2000, ttftMilliseconds: 500 },
      { outputTokens: null, attemptDurationMilliseconds: 1000, ttftMilliseconds: null },
      { outputTokens: 300, attemptDurationMilliseconds: 1000, ttftMilliseconds: 1000 },
      { outputTokens: 0, attemptDurationMilliseconds: 1000, ttftMilliseconds: null },
    ]
    // 只有第一条够格：另外三条的 Token 一个也没进分子，对应的时段也没进分母。
    expect(averageOutputTokensPerSecond(samples)).toBeCloseTo(20 / 1.5, 6)
  })

  it('reports no speed when no sample qualifies', () => {
    expect(averageOutputTokensPerSecond([])).toBeNull()
    expect(averageOutputTokensPerSecond([{ outputTokens: null, attemptDurationMilliseconds: 1000, ttftMilliseconds: null }])).toBeNull()
  })
})

describe('request-level output speed', () => {
  it('reads the last attempt, which is the one the client actually got', () => {
    const log = logOf({
      outputTokens: 50,
      totalDurationMilliseconds: 99_999,
      ttftMilliseconds: 11,
      attempts: [
        { durationMilliseconds: 3000, ttftMilliseconds: 900 },
        { durationMilliseconds: 2000, ttftMilliseconds: 200 },
      ],
    })
    expect(servingAttemptOf(log)?.durationMilliseconds).toBe(2000)
    expect(outputSpeedSampleOf(log)).toEqual({ outputTokens: 50, attemptDurationMilliseconds: 2000, ttftMilliseconds: 200 })
    // 请求级总耗时含上游重试，不能当分母：是 50 / 1.8s，不是 50 / 99.999s。
    expect(requestOutputTokensPerSecond(log)).toBeCloseTo(50 / 1.8, 6)
  })

  it('falls back to the request-level numbers when no attempt was recorded', () => {
    const log = logOf({ outputTokens: 40, totalDurationMilliseconds: 2000, ttftMilliseconds: 500 })
    expect(servingAttemptOf(log)).toBeNull()
    expect(outputSpeedSampleOf(log)).toEqual({ outputTokens: 40, attemptDurationMilliseconds: 2000, ttftMilliseconds: 500 })
    expect(requestOutputTokensPerSecond(log)).toBeCloseTo(40 / 1.5, 6)
  })
})

describe('milliseconds display', () => {
  it('writes milliseconds below a second and seconds above it', () => {
    expect(formatMilliseconds(0)).toBe('0ms')
    expect(formatMilliseconds(999)).toBe('999ms')
    expect(formatMilliseconds(1000)).toBe('1.0s')
    expect(formatMilliseconds(1250)).toBe('1.3s')
    expect(formatMilliseconds(2000)).toBe('2.0s')
  })

  it('writes a dash, not a zero, when there is no sample', () => {
    expect(formatMilliseconds(null)).toBe('—')
    expect(formatMilliseconds(undefined)).toBe('—')
    expect(formatMilliseconds(Number.NaN)).toBe('—')
  })

  it('hands animations the same split between unit and decimals', () => {
    expect(millisecondsDisplayParts(999)).toEqual({ value: 999, decimalPlaces: 0, unit: 'ms' })
    expect(millisecondsDisplayParts(1000)).toEqual({ value: 1, decimalPlaces: 1, unit: 's' })
    expect(millisecondsDisplayParts(1250)).toEqual({ value: 1.25, decimalPlaces: 1, unit: 's' })
  })
})

describe('output speed display', () => {
  it('keeps one decimal below ten and rounds above it', () => {
    expect(formatOutputSpeed(9.6)).toBe('9.6')
    expect(formatOutputSpeed(10)).toBe('10')
    expect(formatOutputSpeed(24)).toBe('24')
    expect(formatOutputSpeed(24.4)).toBe('24')
  })

  it('writes a dash when there is no speed', () => {
    expect(formatOutputSpeed(null)).toBe('—')
    expect(formatOutputSpeed(undefined)).toBe('—')
    expect(formatOutputSpeed(Number.NaN)).toBe('—')
  })

  it('exposes the decimal rule so animated numbers match the text', () => {
    expect(outputSpeedDecimalPlaces(9.6)).toBe(1)
    expect(outputSpeedDecimalPlaces(10)).toBe(0)
  })
})
