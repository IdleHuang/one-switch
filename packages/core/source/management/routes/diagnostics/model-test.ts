import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { listProviderEndpoints, listProviders } from '@server/database/provider-store'
import { listProviderModels } from '@server/database/model-store'
import { generateId } from '@common/utils'
import { findConvertibleEndpoint, findEndpoint } from '../../../proxy/routing/router'
import { buildUpstreamTarget } from '../../../proxy/planners/target-planner'
import { executeProxyRequest } from '../../../proxy/execution/attempt-executor'
import { createRequestContext } from '../../../proxy/request/request-context'
import { createUsageTracker } from '../../../proxy/observers/usage'
import { BufferedProxyResponse } from '../../../proxy/response/proxy-response'
import { HttpRouter } from '@server/http-router'
import { reportTelemetryEvent } from '@server/telemetry'
import type { ManagementHandler } from '../../core/response'
import { sendSuccess } from '../../core/response'
import { tokensPerSecondFromTotals } from '@common/metrics'
import { ModelTestModeSchema, ProtocolSchema, type ModelTestMode, type Protocol } from '@common/schemas'

/** 轮次上限：多测几轮是看稳定性，不是压测，别把一个渠道刷成限流。 */
export const MAX_TEST_ROUNDS = 5
/** 提示词上限：诊断只回答「通不通 / 快不快」，再长就是替用户跑业务请求了。 */
export const MAX_TEST_PROMPT_LENGTH = 20_000

const TestModelsSchema = z.object({
  protocol: ProtocolSchema,
  // 不给模式就是连通性：老界面、老脚本发的请求仍然按原来的语义跑。
  mode: ModelTestModeSchema.default('connectivity'),
  providerIds: z.array(z.string()).optional(),
  modelIds: z.array(z.string()).optional(),
  /** 每个目标重复测几轮；默认 1，与旧行为逐字相同。 */
  rounds: z.number().int().min(1).max(MAX_TEST_ROUNDS).default(1),
  /** 自定义提示词；留空按模式取默认值。 */
  prompt: z.string().max(MAX_TEST_PROMPT_LENGTH).optional(),
  /** 提示词补齐到的字符数；0 表示不补。 */
  inputLength: z.number().int().min(0).max(MAX_TEST_PROMPT_LENGTH).default(0),
})

/**
 * 速度诊断的提示词与上限。
 *
 * 测速度需要一段**够长**的输出：一句话的回答里，出字快慢全被首字节和连接开销盖住。
 * 数数是最省事的长输出——它不需要模型「想」，也不需要采样温度，不同渠道之间可比。
 */
const SPEED_PROMPT = 'Count from 1 to 200, separated by single spaces. Output only the numbers.'
const SPEED_MAX_TOKENS = 512

/** 各模式在用户没写提示词时用的默认值。 */
const DEFAULT_PROMPTS: Record<ModelTestMode, string> = {
  connectivity: 'Hi',
  streaming: 'Hi',
  speed: SPEED_PROMPT,
}

/**
 * 「输入长度」靠这段中性句子补齐。
 *
 * 它必须是可忽略的填充文本：诊断量的是链路的耗时与出字，不是模型读得懂不懂。
 * 用一句固定的英文而不是随机串，是为了让同一组配置在不同渠道之间可比。
 */
const LENGTH_PADDING_SENTENCE = 'Ignore the following filler text, it only exists to make this diagnostic request longer. '

/** 一轮诊断的结论。多轮时界面按它逐轮展开，顶层字段是这一组的汇总。 */
export interface ModelTestRoundResult {
  round: number
  success: boolean
  statusCode?: number
  durationMilliseconds: number
  errorMessage?: string
  inputTokens?: number | null
  outputTokens?: number | null
  ttftMilliseconds?: number | null
  tokensPerSecond?: number | null
}

export interface ModelTestResult {
  modelId: string
  modelName: string
  providerId: string
  providerName: string
  /** 这一次结果是按哪个模式测出来的。界面按它决定展示哪些列。 */
  mode: ModelTestMode
  success: boolean
  statusCode?: number
  durationMilliseconds: number
  errorMessage?: string
  inputTokens?: number | null
  outputTokens?: number | null
  /** 首字节耗时；只有流式/速度诊断量得到，其余模式与没收到正文时为 `null`。 */
  ttftMilliseconds?: number | null
  /** 输出速度；只有速度诊断且成功、且拿得到输出 Token 时才有值。 */
  tokensPerSecond?: number | null
  /** 逐轮明细：单轮时只有一条，老界面可以完全忽略这个字段。 */
  rounds?: ModelTestRoundResult[]
}

function averageOf(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

/**
 * 把多轮明细压成顶层那一行。
 *
 * - `success` 取**全部通过**：跑三轮挂一轮仍然要红，否则「稳定通过」和「碰巧过一次」看起来一样。
 * - 状态码取**第一个失败轮**的：查错要看的是失败那次的 HTTP 码，不是最后一轮碰巧的 200。
 * - 耗时 / TTFT / Token 取各轮均值：多轮之后顶层那一格代表「这个目标的典型值」。
 */
function summarizeRounds(rounds: ModelTestRoundResult[]): Omit<ModelTestResult, 'modelId' | 'modelName' | 'providerId' | 'providerName' | 'mode'> {
  const failure = rounds.find(round => !round.success)
  const ttftValues = rounds
    .map(round => round.ttftMilliseconds)
    .filter((value): value is number => typeof value === 'number')
  const speedValues = rounds
    .map(round => round.tokensPerSecond)
    .filter((value): value is number => typeof value === 'number')
  const inputValues = rounds
    .map(round => round.inputTokens)
    .filter((value): value is number => typeof value === 'number')
  const outputValues = rounds
    .map(round => round.outputTokens)
    .filter((value): value is number => typeof value === 'number')
  const ttft = averageOf(ttftValues)
  const speed = averageOf(speedValues)
  const inputTokens = averageOf(inputValues)
  const outputTokens = averageOf(outputValues)
  return {
    success: rounds.every(round => round.success),
    statusCode: failure?.statusCode ?? rounds.at(-1)?.statusCode,
    durationMilliseconds: Math.round(averageOf(rounds.map(round => round.durationMilliseconds)) ?? 0),
    errorMessage: failure?.errorMessage,
    inputTokens: inputTokens === null ? null : Math.round(inputTokens),
    outputTokens: outputTokens === null ? null : Math.round(outputTokens),
    ttftMilliseconds: ttft === null ? null : Math.round(ttft),
    tokensPerSecond: speed === null ? null : Math.round(speed * 100) / 100,
    rounds,
  }
}

export const modelTestRoutes = new HttpRouter<ManagementHandler>()
  .post('/api/model-test/run', handleTestModels)

async function handleTestModels(req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
  const { protocol, mode, providerIds, modelIds, rounds, prompt, inputLength } = TestModelsSchema.parse(body)
  const bodyOptions: ModelTestBodyOptions = {
    prompt: prompt?.trim() || undefined,
    inputLength,
  }
  // 流式与速度都必须在流式形态下跑：速度诊断要的首字节时刻在整包响应里根本不存在，
  // 所以「测速度」不是「连通性 + 多测几个数」，而是另一种请求写法。
  const streaming = mode !== 'connectivity'
  const controller = new AbortController()
  const onClientAbort = () => controller.abort()
  req.once('aborted', onClientAbort)

  const models = (await listProviderModels()).map(model => ({
    id: model.id,
    providerId: model.providerId,
    modelName: model.modelName,
    endpoints: model.endpoints.map(endpoint => ({
      protocol: endpoint.protocol,
      endpointUrl: endpoint.url ?? '',
      customAuthHeader: null,
      protocolConversionEnabled: endpoint.conversions.some(conversion => conversion.enabled),
    })),
    priority: 0,
    enabled: model.enabled,
    createdTime: model.createdTime,
    updatedTime: model.updatedTime,
    deletedTime: model.deletedTime,
  }))
  const providers = await listProviders()
  const providerMap = new Map(providers.map(p => [p.id, p]))
  const providerEndpoints = new Map(
    await Promise.all(providers.map(async provider => [
      provider.id,
      new Map((await listProviderEndpoints(provider.id)).filter(endpoint => endpoint.enabled).map(endpoint => [endpoint.protocol, endpoint.url])),
    ] as const)),
  )
  const providerFilter = providerIds ? new Set(providerIds) : null
  const modelFilter = modelIds ? new Set(modelIds) : null

  const testableModels = models.filter(model =>
    model.enabled &&
    (findEndpoint(model, protocol) || findConvertibleEndpoint(model, protocol)) &&
    (!providerFilter || providerFilter.has(model.providerId)) &&
    (!modelFilter || modelFilter.has(model.id)),
  )

  const results: ModelTestResult[] = []

  for (const model of testableModels) {
    // 客户端断开时不再补后面的目标：上游请求已经随 `signal` 断掉，接着测只是白花钱。
    if (controller.signal.aborted) break
    const provider = providerMap.get(model.providerId)
    if (!provider) continue

    const directEndpoint = findEndpoint(model, protocol)
    const endpoint = directEndpoint || findConvertibleEndpoint(model, protocol)
    if (!endpoint) continue

    // 诊断要测的是「用户当下保存的那一份」：端点 URL 为空时借用供应商级配置，
    // 与真实请求的区别只在这里，因此直接复用规划器的目标映射，不自己拼字段。
    const candidate = {
      model: {
        ...model,
        endpoints: model.endpoints.map(candidate => ({
          ...candidate,
          endpointUrl: candidate.endpointUrl.trim() || providerEndpoints.get(provider.id)?.get(candidate.protocol) || '',
        })),
      },
      provider,
    }
    const target = buildUpstreamTarget(candidate, protocol)
    if (!target) {
      // 这里只会是「两层都没有地址」：保存时的校验会拦住它，所以只有从旧版本继承下来的
      // 数据会走到这里（见 `packages/core/source/errors.ts` 的 `endpointUrlMissingError`）。
      // 同一个配置每一轮都会得到同样的结论，所以不再重复发 N 轮。
      const failure: ModelTestRoundResult = {
        round: 1,
        success: false,
        durationMilliseconds: 0,
        ttftMilliseconds: null,
        tokensPerSecond: null,
        errorMessage: `No upstream url is configured for protocol ${protocol}`,
      }
      results.push({
        modelId: model.id,
        modelName: model.modelName,
        providerId: provider.id,
        providerName: provider.name,
        mode,
        ...summarizeRounds([failure]),
      })
      continue
    }

    const roundResults: ModelTestRoundResult[] = []
    for (let round = 1; round <= rounds; round += 1) {
      // 客户端断开时不再补后面的轮次：上游请求已经随 `signal` 断掉，接着测只是白花钱。
      if (controller.signal.aborted) break
      const roundResult = await runRound({ target, protocol, modelName: model.modelName, converted: !directEndpoint, mode, streaming, bodyOptions, signal: controller.signal, round })
      // 被取消的那一轮不计入结论：它没有答案，记成失败会把「用户点了取消」算进失败率里。
      if (controller.signal.aborted) break
      roundResults.push(roundResult)
    }
    if (roundResults.length === 0) continue
    results.push({
      modelId: model.id,
      modelName: model.modelName,
      providerId: provider.id,
      providerName: provider.name,
      mode,
      ...summarizeRounds(roundResults),
    })
  }

  const aborted = controller.signal.aborted
  req.removeListener('aborted', onClientAbort)
  // 每个被测目标一条：界面侧把「测试全部模型」拆成若干次请求（一次请求只测一个目标，见
  // `model-test-panel.tsx` 的 `runTasks`），因此这里的一条 `result` 就是那一个目标的结论。
  // 被取消的那次不发——它没有结论，记成失败会把「用户点了取消」算进失败率里（契约注释）。
  if (!aborted && results.length > 0) {
    reportTelemetryEvent({ name: 'provider_tested', result: results.every(result => result.success) ? 'success' : 'failed' })
  }
  // 客户端断开后 socket 已经没了，再写回去只会多一次无意义的写失败；能写就写。
  if (!res.writableEnded && !res.destroyed) sendSuccess(res, { results })
}

interface RunRoundInput {
  target: NonNullable<ReturnType<typeof buildUpstreamTarget>>
  protocol: Protocol
  modelName: string
  converted: boolean
  mode: ModelTestMode
  streaming: boolean
  bodyOptions: ModelTestBodyOptions
  signal: AbortSignal
  round: number
}

/** 跑一轮诊断。异常也收成本轮失败，不往上抛——多轮里挂一轮不该丢掉其余轮的结论。 */
async function runRound(input: RunRoundInput): Promise<ModelTestRoundResult> {
  const startedAt = Date.now()
  try {
    const testBody = buildTestBody(input.protocol, input.modelName, input.converted, input.mode, input.bodyOptions)
    const probe = input.streaming ? new StreamProbeResponse() : null
    const response: BufferedProxyResponse = probe ?? new BufferedProxyResponse()
    await executeProxyRequest({
      context: createRequestContext({
        requestId: generateId('req_'),
        logicalModelId: 'diagnostic',
        clientProtocol: input.protocol,
        // 客户端跳的形态由我们声明：上游会照着这个形态回，而我们正是要看它照不照做。
        transport: input.streaming ? 'http-stream' : 'http',
        method: 'POST',
        path: `/diagnostic/${input.protocol}`,
        headers: {
          accept: input.streaming ? 'text/event-stream' : 'application/json',
          'content-type': 'application/json',
        },
        requestBody: Buffer.from(testBody),
        signal: input.signal,
      }),
      targets: [input.target],
      response,
      // 连接测试是内部执行：它的用量由 `provider_tested` 回答，不是客户端任务（见 `ExecutionOrigin`）。
      origin: 'internal',
    })
    const success = response.statusCode >= 200 && response.statusCode < 400
    // 流式的正文是 SSE，`readUsage` 那个「解一个 JSON」的读法在它面前永远是空的：
    // 用量由同一个累加器从流里读走（它也是唯一还在数首字的地方）。
    const usage = probe ? probe.usage() : readUsage(response.body)
    const durationMilliseconds = Date.now() - startedAt
    return {
      round: input.round,
      success,
      statusCode: response.statusCode || undefined,
      durationMilliseconds,
      errorMessage: success ? undefined : getDiagnosticError(response),
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      ttftMilliseconds: probe ? probe.firstOutputElapsed(startedAt) : null,
      tokensPerSecond: success && input.mode === 'speed' ? tokensPerSecondFromTotals(usage.outputTokens ?? 0, durationMilliseconds) : null,
    }
  } catch (error) {
    return {
      round: input.round,
      success: false,
      durationMilliseconds: Date.now() - startedAt,
      ttftMilliseconds: null,
      tokensPerSecond: null,
      errorMessage: (error as Error).message,
    }
  }
}

/**
 * 从诊断响应里读出用量：三种协议的字段名不同，但都只给「输入 / 输出」两个数。
 * 读不到就返回 `null`，界面用 `—` 占位——诊断面板宁可显示未知，也不编一个 0 出来。
 *
 * 导出仅供单测。
 */
export function readUsage(body: string): { inputTokens: number | null; outputTokens: number | null } {
  const empty = { inputTokens: null, outputTokens: null }
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

function getDiagnosticError(response: BufferedProxyResponse): string {
  if (response.failureMessage) return response.failureMessage
  try {
    const body = JSON.parse(response.body) as { errorMessage?: unknown; error?: { message?: unknown } }
    if (typeof body.errorMessage === 'string' && body.errorMessage.trim()) return body.errorMessage
    if (typeof body.error?.message === 'string' && body.error.message.trim()) return body.error.message
  } catch {
    // Non-JSON upstream responses fall back to their HTTP status.
  }
  return `HTTP ${response.statusCode || 502}`
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
 *
 * 导出仅供单测。
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
  usage(): { inputTokens: number | null; outputTokens: number | null } {
    this.tracker.flush()
    const usage = this.tracker.usage()
    return { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens }
  }
}

/** 导出仅供单测：诊断请求的默认正文是最容易被改错的一块。 */
export interface ModelTestBodyOptions {
  /** 自定义提示词；不传/空串时按模式取默认值。 */
  prompt?: string
  /** 提示词补齐到的字符数；0 表示不补。 */
  inputLength?: number
}

/**
 * 把提示词补齐到指定长度。
 *
 * 「输入长度」量的是**长上下文下的链路表现**（预填充耗时、网关缓冲），所以补的是中性的
 * 填充句子而不是重复同一个字符：多数网关会把重复字符压掉，那样长度就白加了。
 * 只补不截：用户写的提示词已经超过目标长度时，尊重他写的那份。
 */
export function padPrompt(prompt: string, inputLength: number): string {
  if (inputLength <= 0 || prompt.length >= inputLength) return prompt
  // 分隔符也算长度：先扣掉那`\n\n`，否则补出来的正文总比用户填的目标多两个字。
  const separator = '\n\n'
  const paddingLength = inputLength - prompt.length - separator.length
  if (paddingLength <= 0) return prompt
  const repeats = Math.ceil(paddingLength / LENGTH_PADDING_SENTENCE.length)
  return `${prompt}${separator}${LENGTH_PADDING_SENTENCE.repeat(repeats).slice(0, paddingLength)}`
}

export function buildTestBody(protocol: Protocol, modelId: string, converted: boolean, mode: ModelTestMode = 'connectivity', options: ModelTestBodyOptions = {}): string {
  // 速度诊断要一段足够长的输出，否则出字快慢全被首字节和连接开销盖住；
  // 其余模式只问「通不通」，一句话就够，也就没有成本风险。
  const basePrompt = options.prompt?.trim() || DEFAULT_PROMPTS[mode]
  const prompt = padPrompt(basePrompt, options.inputLength ?? 0)
  // 流式与否写在请求体里，不是写在头上：三种协议都靠 `stream: true` 表达这件事，
  // 上游也只认这个字段（Anthropic 同样是给 `stream` 才回 SSE）。速度诊断也要流式，
  // 否则量不到首字节与出字。
  const stream = mode !== 'connectivity'
  switch (protocol) {
    case 'openai-completions':
      return JSON.stringify({
        model: modelId,
        ...(stream ? { stream: true } : {}),
        messages: [{ role: 'user', content: prompt }],
      })
    case 'openai-responses':
      return JSON.stringify({
        model: modelId,
        ...(stream ? { stream: true } : {}),
        input: [{ role: 'user', content: prompt }],
      })
    case 'anthropic-messages':
      return JSON.stringify({
        model: modelId,
        // `/v1/messages` 把 max_tokens 当必填，不给就是 400；而且不给的话
        // 转换层会补一个 4096 的上限，一条「Hi」理论上有成本风险，所以这里自己压到最小。
        // 走协议转换时不加：转换后的目标多是 OpenAI 形态，o 系模型只认 max_completion_tokens，
        // 塞 max_tokens 反而会换来一个 400。
        ...(converted ? {} : { max_tokens: mode === 'speed' ? SPEED_MAX_TOKENS : 16 }),
        ...(stream ? { stream: true } : {}),
        messages: [{ role: 'user', content: prompt }],
      })
  }
}
