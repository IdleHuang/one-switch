import { asArray, asNumber, asObject, asString, stringifyContent, type Json } from './conversion-utils'
import { ToolNameRegistry } from './tool-name-registry'

/**
 * OpenAI Responses 请求 → OpenAI Chat Completions 请求。
 *
 * 字段依据见 docs/references/openai-responses.md 与 docs/references/openai-completions.md。
 *
 * Responses 的 `input` 是「输入项列表」（EasyInputMessage / function_call /
 * function_call_output / reasoning / item_reference 等），与 Chat Completions 的
 * `messages` 不是一一对应，需要按项类型分别映射：
 * - EasyInputMessage / message ↔ 普通 message
 * - 连续的 function_call ↔ 合并为一个 assistant 消息的 `tool_calls`
 * - function_call_output ↔ `role: tool` 消息
 * - reasoning / item_reference ↔ 丢弃（无对应语义）
 *
 * Responses 的 `tools` 里还有 `type: "namespace"` 的嵌套工具组，组内工具用
 * `(namespace, name)` 共同寻址；Chat 没有命名空间维度，因此把组内工具展平成顶层工具，
 * 并把对应关系写进 `toolNames` 供响应侧还原（见 `tool-name-registry.ts`）。
 */

/**
 * Responses 的 `input_image.detail` 比 Chat Completions 多一个 `original`。
 * Chat 只接受 `auto` / `low` / `high`，无法等价的值直接丢弃，不自行折算。
 */
function responsesImageDetailToOpenAi(detail: unknown): string | undefined {
  return detail === 'auto' || detail === 'low' || detail === 'high' ? detail : undefined
}

function responsesContentPartsToOpenAi(content: unknown): Json[] {
  if (typeof content === 'string') return content ? [{ type: 'text', text: content }] : []
  const parts: Json[] = []
  for (const raw of asArray(content)) {
    const part = asObject(raw)
    if (!part) continue
    if (part.type === 'input_text' || part.type === 'output_text' || part.type === 'text') {
      const text = asString(part.text)
      if (text === undefined) continue
      parts.push({ type: 'text', text, ...(part.prompt_cache_breakpoint ? { prompt_cache_breakpoint: part.prompt_cache_breakpoint } : {}) })
    } else if (part.type === 'input_image') {
      // Responses 的 `image_url` 是裸字符串（旧版客户端会包成 `{ url }`），两个形态都收。
      const imageUrl = asString(part.image_url) ?? asString(asObject(part.image_url)?.url)
      const detail = responsesImageDetailToOpenAi(part.detail)
      if (imageUrl) {
        parts.push({
          type: 'image_url',
          image_url: { url: imageUrl, ...(detail ? { detail } : {}) },
          ...(part.prompt_cache_breakpoint ? { prompt_cache_breakpoint: part.prompt_cache_breakpoint } : {}),
        })
      }
    }
    // input_file / input_audio / refusal 等无对应能力，丢弃
  }
  return parts
}

function partsToMessageContent(parts: Json[]): string | Json[] | null {
  if (parts.length === 0) return null
  if (parts.length === 1 && parts[0].type === 'text' && parts[0].prompt_cache_breakpoint === undefined) {
    return parts[0].text as string
  }
  return parts
}

function functionToolToOpenAi(tool: Json, name: string, namespaceDescription?: string): Json | null {
  if (!name) return null
  // 命名空间描述带的是「这一组工具是干什么的」，是模型选工具时的上下文；Chat 的工具没有
  // 分组维度，只能把它拼进每个组内工具的描述里，否则这段语义在转换中直接蒸发。
  const description = [namespaceDescription, asString(tool.description)]
    .filter((part): part is string => Boolean(part))
    .join('\n\n')
  return {
    type: 'function',
    function: {
      name,
      description,
      parameters: asObject(tool.parameters) ?? { type: 'object', properties: {} },
      ...(typeof tool.strict === 'boolean' ? { strict: tool.strict } : {}),
    },
  }
}

/**
 * 顶层工具名在 Chat 里必须原样保留，因此要**先**占位：
 * - 展平结果不能把它们挤掉；
 * - 占位必须早于 `input` 转换：`input` 里可能带着 namespace 限定的历史调用，
 *   它也会登记展平名，若晚一步就会先到先得。
 */
function reserveTopLevelToolNames(raw: unknown, toolNames: ToolNameRegistry): void {
  for (const item of asArray(raw)) {
    const tool = asObject(item)
    if (tool?.type === 'function') toolNames.reserve(asString(tool.name) ?? '')
  }
}

/**
 * Responses 的 `tools` 是「工具或工具组」的联合：
 * - `type: "function"` 顶层工具 ↔ 原样映射，名字必须保持不变
 * - `type: "namespace"` 工具组 ↔ 组内 function 逐个展平成顶层工具，并把
 *   `(namespace, name)` ↔ 展平名 登记到 `toolNames`；组内的 custom 工具仍丢弃
 * - `custom` / `mcp` / `tool_search` / `file_search` 等托管工具 ↔ 无对应能力，丢弃
 *
 * 输出顺序与输入一致（不把展平结果归堆），这样工具列表在多次请求间保持稳定，
 * 不会白白抖掉上游的 prompt cache。
 */
function responsesToolsToOpenAi(raw: unknown, toolNames: ToolNameRegistry): Json[] {
  reserveTopLevelToolNames(raw, toolNames)
  const tools: Json[] = []
  for (const item of asArray(raw)) {
    const tool = asObject(item)
    if (!tool) continue
    if (tool.type === 'function') {
      const converted = functionToolToOpenAi(tool, asString(tool.name) ?? '')
      if (converted) tools.push(converted)
      continue
    }
    if (tool.type !== 'namespace') continue
    const namespace = asString(tool.name)
    if (!namespace) continue
    const namespaceDescription = asString(tool.description)
    for (const rawNested of asArray(tool.tools)) {
      const nested = asObject(rawNested)
      if (nested?.type !== 'function') continue
      const nestedName = asString(nested.name)
      if (!nestedName) continue
      const converted = functionToolToOpenAi(nested, toolNames.flatten(namespace, nestedName), namespaceDescription)
      if (converted) tools.push(converted)
    }
  }
  return tools
}

function responsesToolChoiceToOpenAi(choice: unknown): unknown {
  if (choice === 'auto' || choice === 'none' || choice === 'required') return choice
  const record = asObject(choice)
  if (!record) return undefined
  // `ToolChoiceFunction` 只有 `name`、没有 `namespace`（见 docs/references/openai-responses.md），
  // 所以这里拿不到命名空间信息，只能原样透传客户端写的名字。
  if (record.type === 'function' && asString(record.name)) {
    return { type: 'function', function: { name: record.name } }
  }
  return undefined
}

function responsesTextFormatToResponseFormat(text: unknown): Json | undefined {
  const format = asObject(asObject(text)?.format)
  if (!format) return undefined
  if (format.type === 'json_object') return { type: 'json_object' }
  if (format.type === 'json_schema' && asString(format.name)) {
    const schema = asObject(format.schema) ?? {}
    return {
      type: 'json_schema',
      json_schema: {
        name: format.name,
        schema,
        ...(typeof format.strict === 'boolean' ? { strict: format.strict } : {}),
        ...(asString(format.description) !== undefined ? { description: format.description } : {}),
      },
    }
  }
  return undefined
}

/** 追加 function_call 到上一条 assistant 消息，或新建一条。 */
function appendFunctionCall(messages: Json[], call: Json): void {
  const last = asObject(messages[messages.length - 1])
  if (last?.role === 'assistant' && last.content === null && Array.isArray(last.tool_calls)) {
    ;(last.tool_calls as Json[]).push(call)
    return
  }
  messages.push({ role: 'assistant', content: null, tool_calls: [call] })
}

function functionCallToToolCall(source: Json, toolNames: ToolNameRegistry): Json | null {
  const name = asString(source.name)
  if (!name) return null
  const args = source.arguments
  // 带 `namespace` 的调用是工具组里的工具，模型在请求里看到的是展平名，历史消息必须
  // 用同一个展平名，否则模型会看到一个自己从没被给过的工具名。
  const namespace = asString(source.namespace)
  return {
    id: asString(source.call_id) ?? asString(source.id) ?? '',
    type: 'function',
    function: {
      name: namespace ? toolNames.flatten(namespace, name) : name,
      arguments: typeof args === 'string' ? args : JSON.stringify(args ?? {}),
    },
  }
}

function pushToolOutput(messages: Json[], source: Json): void {
  messages.push({ role: 'tool', tool_call_id: asString(source.call_id) ?? '', content: stringifyContent(source.output) })
}

function pushRoleMessage(role: string, content: string | Json[] | null, messages: Json[]): void {
  if (content === null) return
  if (role === 'system' || role === 'developer') {
    messages.push({ role: 'system', content })
    return
  }
  messages.push({ role: role === 'assistant' ? 'assistant' : 'user', content })
}

/**
 * 处理 message 项的内容。Responses 规范把 function_call / function_call_output 定义为
 * 顶层输入项，但历史客户端（以及本仓库既有用例）会把它们嵌在 content 数组里，
 * 因此两种形态都要支持：遇到工具项时先冲刷已缓冲的普通内容，保证顺序不变。
 */
function convertMessageContent(role: string, content: unknown, messages: Json[], toolNames: ToolNameRegistry): void {
  if (typeof content === 'string') {
    if (content) pushRoleMessage(role, content, messages)
    return
  }
  let buffered: Json[] = []
  const flush = (): void => {
    if (buffered.length === 0) return
    pushRoleMessage(role, partsToMessageContent(buffered), messages)
    buffered = []
  }
  for (const rawPart of asArray(content)) {
    const part = asObject(rawPart)
    if (!part) continue
    if (part.type === 'function_call') {
      flush()
      const call = functionCallToToolCall(part, toolNames)
      if (call) appendFunctionCall(messages, call)
      continue
    }
    if (part.type === 'function_call_output') {
      flush()
      pushToolOutput(messages, part)
      continue
    }
    buffered.push(...responsesContentPartsToOpenAi([rawPart]))
  }
  flush()
}

function convertInputItem(item: unknown, messages: Json[], toolNames: ToolNameRegistry): void {
  if (typeof item === 'string') {
    if (item) messages.push({ role: 'user', content: item })
    return
  }
  const record = asObject(item)
  if (!record) return

  if (record.type === 'function_call') {
    const call = functionCallToToolCall(record, toolNames)
    if (call) appendFunctionCall(messages, call)
    return
  }
  if (record.type === 'function_call_output') {
    pushToolOutput(messages, record)
    return
  }
  if (record.type === 'reasoning' || record.type === 'item_reference') return

  const role = asString(record.role)
  if (!role) return
  convertMessageContent(role, record.content, messages, toolNames)
}

export function responsesToOpenAiRequest(body: Json, model: string, toolNames: ToolNameRegistry = new ToolNameRegistry()): Json {
  // 占位要早于 input 转换：历史里的 namespace 限定调用也会往同一张表里登记展平名。
  reserveTopLevelToolNames(body.tools, toolNames)
  const messages: Json[] = []
  const instructions = asString(body.instructions)
  if (instructions) messages.push({ role: 'system', content: instructions })

  if (typeof body.input === 'string') {
    if (body.input) messages.push({ role: 'user', content: body.input })
  } else {
    for (const item of asArray(body.input)) convertInputItem(item, messages, toolNames)
  }

  const result: Json = { model, messages }

  for (const field of ['prompt_cache_key', 'prompt_cache_retention', 'prompt_cache_options', 'metadata', 'user', 'parallel_tool_calls'] as const) {
    if (body[field] !== undefined) result[field] = body[field]
  }

  const maxTokens = asNumber(body.max_output_tokens)
  if (maxTokens !== undefined) result.max_tokens = maxTokens
  const temperature = asNumber(body.temperature)
  if (temperature !== undefined) result.temperature = temperature
  const topP = asNumber(body.top_p)
  if (topP !== undefined) result.top_p = topP
  if (body.stream === true) result.stream = true

  const effort = asString(asObject(body.reasoning)?.effort)
  if (effort) result.reasoning_effort = effort

  const tools = responsesToolsToOpenAi(body.tools, toolNames)
  if (tools.length > 0) result.tools = tools

  const toolChoice = responsesToolChoiceToOpenAi(body.tool_choice)
  if (toolChoice !== undefined) result.tool_choice = toolChoice

  const responseFormat = responsesTextFormatToResponseFormat(body.text)
  if (responseFormat) result.response_format = responseFormat

  return result
}
