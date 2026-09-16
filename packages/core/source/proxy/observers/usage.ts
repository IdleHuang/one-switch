import type { RawUsage } from '@common/schemas'

/** 从上游报文里读到的用量。字段为 `null` 表示上游没报；不是 0。 */
export interface ExtractedUsage {
  inputTokens: number | null
  outputTokens: number | null
  reasoningTokens: number | null
  cachedInputTokens: number | null
  cacheCreationInputTokens: number | null
  rawUsage: RawUsage | null
}

export function emptyUsage(): ExtractedUsage {
  return {
    inputTokens: null,
    outputTokens: null,
    reasoningTokens: null,
    cachedInputTokens: null,
    cacheCreationInputTokens: null,
    rawUsage: null,
  }
}

/**
 * 用量累积器。
 *
 * 上游把用量藏在哪一层各家不同（`usage` / `usageMetadata` / `message.usage` …），
 * 也可能分散在多个 SSE 事件里（首个事件只报输入、末个事件才报输出），
 * 因此这里既能吃整段 JSON，也能逐块吃 SSE 并在返回后合并。
 *
 * 「有没有真实生成内容」由返回值告诉调用方：TTFT 只在真正收到输出时才成立，
 * 只有 role 的起始事件、只报用量的收尾事件都不算。
 */
export interface UsageTracker {
  usage(): ExtractedUsage
  /** 吃一段完整 JSON 报文；返回其中是否含有真实生成内容。 */
  consumeJson(body: string): boolean
  /** 吃一段 SSE 字节流；返回其中是否出现了真实生成内容。 */
  consumeSseChunk(text: string): boolean
  /** 收尾：把最后一段没有换行结尾的 SSE 行也吃掉。 */
  flush(): boolean
}

export function createUsageTracker(): UsageTracker {
  let usage = emptyUsage()
  let pending = ''
  return {
    usage: () => usage,
    consumeJson(body: string): boolean {
      return accumulateJson(body, current => { usage = current })
    },
    consumeSseChunk(text: string): boolean {
      pending += text
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      let hasOutput = false
      for (const line of lines) {
        if (accumulateSseLine(line, current => { usage = current })) hasOutput = true
      }
      return hasOutput
    },
    flush(): boolean {
      const line = pending
      pending = ''
      return accumulateSseLine(line, current => { usage = current })
    },
  }

  function accumulateSseLine(line: string, apply: (usage: ExtractedUsage) => void): boolean {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) return false
    const data = trimmed.slice(5).trim()
    if (!data || data === '[DONE]') return false
    return accumulateJson(data, apply)
  }

  function accumulateJson(body: string, apply: (usage: ExtractedUsage) => void): boolean {
    let data: Record<string, unknown>
    try {
      data = JSON.parse(body) as Record<string, unknown>
    } catch {
      // 用量是尽力而为的观察：上游事件格式不对也必须继续转发。
      return false
    }
    apply(mergeUsage(usage, extractTokenUsage(data)))
    return hasOutput(data)
  }
}

/**
 * 这一段报文里有没有**真实生成内容**——首字延迟靠它打点。
 *
 * 「真实内容」既包括正文，也包括推理内容：推理 Token 同样是上游生成的、同样会流到客户端，
 * 只认正文会让推理模型的首字延迟虚高到整段思考结束。上游报的输出 Token 本来就含推理 Token，
 * 分子认它、首字却不认它，两个量就对不上了。
 *
 * 只说明「连接还活着」或「我结束了」的帧——纯角色帧、纯用量帧、`[DONE]`——一律不算。
 */
export function hasOutput(data: Record<string, unknown>): boolean {
  const choices = Array.isArray(data.choices) ? data.choices : []
  for (const choice of choices) {
    const record = asRecord(choice)
    const delta = asRecord(record?.delta)
    const message = asRecord(record?.message)
    if (hasValue(delta?.content) || hasValue(delta?.tool_calls) || hasValue(delta?.function_call) || hasValue(delta?.refusal)
      || hasValue(delta?.reasoning_content) || hasValue(delta?.reasoning)
      || hasValue(record?.text) || hasValue(message?.content)
      || hasValue(message?.reasoning_content) || hasValue(message?.reasoning)) return true
  }

  const type = typeof data.type === 'string' ? data.type : ''
  if (type === 'content_block_delta') {
    const delta = asRecord(data.delta)
    if (!delta) return false
    // Anthropic 的思考块走 `thinking_delta`，与正文块平级，同样是真实内容。
    return (delta.type === 'text_delta' && hasValue(delta.text)) || (delta.type === 'thinking_delta' && hasValue(delta.thinking))
  }
  if (type === 'response.output_text.delta' || type === 'response.reasoning_summary_text.delta' || type === 'response.reasoning_text.delta') {
    return hasValue(data.delta)
  }
  if (type === 'response.function_call_arguments.delta' || type === 'response.custom_tool_call_input.delta') {
    return hasValue(data.delta)
  }
  return false
}

function hasValue(value: unknown): boolean {
  if (typeof value === 'string') return value.length > 0
  return value !== null && value !== undefined
}

export function extractTokenUsage(data: Record<string, unknown>): ExtractedUsage {
  const candidates: RawUsage[] = []
  collectUsage(data.usage, candidates)
  collectUsage(data.usageMetadata, candidates)
  collectUsage(data.usage_metadata, candidates)
  collectUsage(asRecord(data.message)?.usage, candidates)
  collectUsage(asRecord(data.response)?.usage, candidates)
  if (Array.isArray(data.output)) {
    for (const item of data.output) collectUsage(asRecord(item)?.usage, candidates)
  }

  let rawUsage: RawUsage | null = null
  for (const candidate of candidates) rawUsage = mergeRawUsage(rawUsage, candidate)
  const cacheCreation = asRecord(rawUsage?.cache_creation)
  const promptDetails = asRecord(rawUsage?.prompt_tokens_details)
  const inputDetails = asRecord(rawUsage?.input_tokens_details)
  const cachedInputTokens = firstNumber(promptDetails?.cached_tokens, inputDetails?.cached_tokens, rawUsage?.cache_read_input_tokens, rawUsage?.cached_input_tokens, rawUsage?.cache_read_tokens, rawUsage?.cachedContentTokenCount, rawUsage?.total_cached_tokens)
  const cacheCreationInputTokens = firstNumber(promptDetails?.cache_write_tokens, inputDetails?.cache_write_tokens, rawUsage?.cache_creation_input_tokens, rawUsage?.cache_creation_tokens, rawUsage?.cached_creation_input_tokens, rawUsage?.cache_write_tokens, sumNumbers(cacheCreation?.ephemeral_5m_input_tokens, cacheCreation?.ephemeral_1h_input_tokens))
  const reportedInputTokens = firstNumber(rawUsage?.prompt_tokens, rawUsage?.input_tokens, rawUsage?.total_input_tokens, rawUsage?.promptTokenCount, data.input_tokens, data.prompt_tokens)
  const usesAnthropicInputSemantics = rawUsage?.cache_read_input_tokens !== undefined
    || rawUsage?.cache_creation_input_tokens !== undefined
    || rawUsage?.cache_creation !== undefined
  return {
    inputTokens: reportedInputTokens === null || !usesAnthropicInputSemantics
      ? reportedInputTokens
      : reportedInputTokens + (cachedInputTokens ?? 0) + (cacheCreationInputTokens ?? 0),
    outputTokens: firstNumber(rawUsage?.completion_tokens, rawUsage?.output_tokens, rawUsage?.total_output_tokens, rawUsage?.candidatesTokenCount, data.output_tokens, data.completion_tokens),
    cachedInputTokens,
    cacheCreationInputTokens,
    reasoningTokens: firstNumber(asRecord(rawUsage?.completion_tokens_details)?.reasoning_tokens, asRecord(rawUsage?.output_tokens_details)?.reasoning_tokens, rawUsage?.reasoning_tokens),
    rawUsage,
  }
}

/**
 * 合并两次读数。
 *
 * 「后到的覆盖先到的」是常态：上游常在收尾事件里才报完整用量，先到的读数往往只有半份。
 * 但 0 既可能是真实的 0 也可能是占位，而正数一定不是「没有用量」，所以一个 0 读数不许
 * 盖掉已经读到的正数——否则逐事件在两套字段间切换的网关会先报出真实值，再被后一个只带
 * 占位 0 的事件抹掉。这与 {@link firstNumber} 先撞上占位 0 是同一个错误，
 * 只是发生在事件之间而不是字段之间。
 */
function mergeNumber(current: number | null, incoming: number | null): number | null {
  if (incoming === null) return current
  if (incoming === 0 && current !== null && current > 0) return current
  return incoming
}

function mergeUsage(current: ExtractedUsage, incoming: ExtractedUsage): ExtractedUsage {
  return {
    inputTokens: mergeNumber(current.inputTokens, incoming.inputTokens),
    outputTokens: mergeNumber(current.outputTokens, incoming.outputTokens),
    cachedInputTokens: mergeNumber(current.cachedInputTokens, incoming.cachedInputTokens),
    cacheCreationInputTokens: mergeNumber(current.cacheCreationInputTokens, incoming.cacheCreationInputTokens),
    reasoningTokens: mergeNumber(current.reasoningTokens, incoming.reasoningTokens),
    rawUsage: mergeRawUsage(current.rawUsage, incoming.rawUsage),
  }
}

function collectUsage(value: unknown, target: RawUsage[]): void {
  const usage = asRecord(value)
  if (usage) target.push(usage)
}

function asRecord(value: unknown): RawUsage | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RawUsage : null
}

/**
 * 取第一个可用的数值：优先正数，全为 0 时回落到 0。
 *
 * 有些聚合网关会在同一个 `usage` 报文里同时给两套字段，并且把其中一套写成占位 0：
 * Chat 风格的 `prompt_tokens` / `completion_tokens` 是 0，真实值在 Responses 风格的
 * `input_tokens` / `output_tokens`（以及 `input_tokens_details.cached_tokens`）里。
 * 按字段顺序取「第一个数字」会先撞上占位 0，于是输入、输出、缓存全被记成 0，
 * TPS 与缓存命中率因为分子为 0 直接算不出来。
 *
 * 判据只能是「0 是不是占位」——上游真报 0 时所有候选都是 0，此时回落值仍是 0，
 * 不会把「真实的 0」变成「没上报」。反过来只要有一个正数候选，它一定比占位 0 可信：
 * 没有哪家上游会用正数表达「没有用量」。
 */
function firstNumber(...values: unknown[]): number | null {
  let fallback: number | null = null
  for (const value of values) {
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    if (value > 0) return value
    if (fallback === null) fallback = value
  }
  return fallback
}

function sumNumbers(...values: unknown[]): number | null {
  const numbers = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  return numbers.length > 0 ? numbers.reduce((sum, value) => sum + value, 0) : null
}

function mergeRawUsage(current: RawUsage | null, incoming: RawUsage | null): RawUsage | null {
  if (!incoming) return current
  if (!current) return { ...incoming }
  const merged: RawUsage = { ...current }
  for (const [key, value] of Object.entries(incoming)) {
    const currentValue = asRecord(merged[key])
    const incomingValue = asRecord(value)
    merged[key] = currentValue && incomingValue ? mergeRawUsage(currentValue, incomingValue) : value
  }
  return merged
}
