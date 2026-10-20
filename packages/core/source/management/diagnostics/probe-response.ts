import { createUsageTracker } from '../../proxy/observers/usage'
import { BufferedProxyResponse } from '../../proxy/response/proxy-response'

/**
 * 从诊断响应里读出用量。
 *
 * 三种协议的字段名不同，但都只给「输入 / 输出」两个数；读不到就返回 `null`，
 * 界面用 `—` 占位——诊断面板宁可显示未知，也不编一个 0 出来。
 */
export function readUsage(body: string): DiagnosticUsage {
  const empty: DiagnosticUsage = { inputTokens: null, outputTokens: null }
  try {
    const usage = (JSON.parse(body) as { usage?: Record<string, unknown> }).usage
    if (!usage) return empty
    // 与 `observers/usage.ts` 同一口径：有些网关在同一个 usage 里既给 Chat 风格字段
    // （占位 0）又给 Responses 风格字段（真实值），按顺序取「第一个数字」会先撞上占位 0。
    // 因此优先取正数，一个都没有时才回落到 0。
    const pick = (...keys: string[]): number | null => {
      let fallback: number | null = null
      for (const key of keys) {
        const value = usage[key]
        if (typeof value !== 'number' || !Number.isFinite(value)) continue
        if (value > 0) return value
        if (fallback === null) fallback = value
      }
      return fallback
    }
    return {
      inputTokens: pick('prompt_tokens', 'input_tokens'),
      outputTokens: pick('completion_tokens', 'output_tokens'),
    }
  } catch {
    return empty
  }
}

/** 一次探测读到的用量。`null` 是「上游没报」，不是「零个」。 */
export interface DiagnosticUsage {
  inputTokens: number | null
  outputTokens: number | null
}

/**
 * 流式诊断的出口：它同时也是这次诊断的字节读者。
 *
 * `BufferedProxyResponse` 只攒正文、不留时刻，而流式诊断要回答「第一个字隔了多久才到」。
 * 这里刻意不记「第一块字节」而记「第一段真实生成内容」，与代理落库的首字延迟同一口径
 * （见 `proxy/observers/attempt-observer.ts`）：上游先回一帧 role、再回一帧用量，都不是
 * 用户看到的字；按字节打点会让同一个渠道在诊断面板里的首字比观测页上低一截。
 *
 * 用量也从同一段流里读：SSE 的 usage 散在若干帧上（多数渠道只挂在收尾帧），
 * 能读懂它的只有那个累加器，所以不为「流式」另写一份拆帧逻辑。
 *
 * 形态对不对（上游到底有没有按 SSE 分帧）不在这里判——那是执行器的职责，上游回整包时
 * 这次尝试会被直接判成失败，因此「测得出首字」本身就意味着帧真的是逐块到的。
 */
export class StreamProbeResponse extends BufferedProxyResponse {
  private readonly tracker = createUsageTracker()
  private firstOutputAt: number | null = null

  override write(chunk: string): boolean {
    if (this.tracker.consumeSseChunk(chunk) && this.firstOutputAt === null) this.firstOutputAt = Date.now()
    return super.write(chunk)
  }

  /** 首字耗时；上游一个真实内容都没给过时返回 `null`——没测到不是测得 0。 */
  firstOutputElapsed(startedAt: number): number | null {
    return this.firstOutputAt === null ? null : this.firstOutputAt - startedAt
  }

  /** 上游在流里上报的用量；读不到就是 `null`，界面用 `—` 占位。 */
  usage(): DiagnosticUsage {
    this.tracker.flush()
    const usage = this.tracker.usage()
    return { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens }
  }
}
