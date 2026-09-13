export type UpstreamStatusDisposition = 'success' | 'failover' | 'terminal'
export type HealthFailureScope = 'provider' | 'provider-model' | 'none'

export interface HealthFailureInput {
  statusCode: number | null
  responseBody?: string | null
  /**
   * 上游 2xx 但没有兼现客户端跳要求的形态（要 `http-stream` 却回了非 SSE 的整包，或反之）。
   *
   * 这个事实必须**单独告知**：状态码在这一种失败里是没有用的——`200` 落在成功区间，
   * 按状态码分类只会得到 `'none'`，于是这个模型永远不会被冷却，下一次请求依旧会选中它（§1.2）。
   */
  transportMismatch?: boolean
  /**
   * 响应头已经到手、正文搬到一半却断了（上游 2xx 但没有把这份正文交完）。
   *
   * 与 `transportMismatch` 同样的道理：失败的事实不在状态码里，只说给调用方听。
   */
  streamInterrupted?: boolean
}

/** 状态码之外的失败事实；`recordHealthFailure` 用它把「这次失败长什么样」整份传下去。 */
export type HealthFailureHints = Omit<HealthFailureInput, 'statusCode'>

export function classifyUpstreamStatus(statusCode: number): UpstreamStatusDisposition {
  if (statusCode >= 200 && statusCode < 300) return 'success'
  // 上游状态码无法证明请求在其他供应商也一定无效，默认优先切换供应商：
  // `400`/`422` 最常见的来源是「这家不支持这个参数」，换一家就成立了，
  // 因此不能只因为「是 4xx」就把它当成请求本身的问题交给客户端。
  return 'failover'
}

export function classifyHealthFailure(input: HealthFailureInput): HealthFailureScope {
  const { statusCode, responseBody, transportMismatch, streamInterrupted } = input
  // 「没兼现要求」与「正文没搬完」都是**这个模型**没做到：同样的请求在别的候选上可能就能做到，
  // 因此冷却的粒度是 provider-model，而不是整个 provider。
  if (transportMismatch) return 'provider-model'
  if (streamInterrupted) return 'provider-model'
  if (statusCode === null) return 'provider'
  if (statusCode === 401 || statusCode === 403) return 'provider'
  if (statusCode === 429) {
    const normalizedBody = responseBody?.toLowerCase() ?? ''
    const providerLimited = /(?:account|organization|project|provider|api[ _-]?key).*(?:quota|rate[ _-]?limit)|(?:quota|rate[ _-]?limit).*(?:account|organization|project|provider|api[ _-]?key)/.test(normalizedBody)
    return providerLimited ? 'provider' : 'provider-model'
  }
  if (statusCode === 404 || statusCode === 408 || statusCode >= 500) return 'provider-model'
  return 'none'
}
