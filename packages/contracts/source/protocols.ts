import type { Protocol } from './schemas'

/** 端点原生协议可接收的客户端协议。 */
export const CONVERTIBLE_PROTOCOLS: Readonly<Record<Protocol, readonly Protocol[]>> = {
  'openai-completions': ['anthropic-messages', 'openai-responses'],
  'openai-responses': [],
  'anthropic-messages': ['openai-completions'],
}

export function isConvertible(endpointProtocol: Protocol, clientProtocol: Protocol): boolean {
  return endpointProtocol !== clientProtocol
    && CONVERTIBLE_PROTOCOLS[endpointProtocol].includes(clientProtocol)
}

/**
 * 协议的认证头构造规则。
 * 认证是协议的属性，所以和转换能力矩阵放在一起声明：代理透传与管理端的模型列表获取共用同一份规则，
 * 不需要任何一方去 import 对方的内部实现。
 */
export interface ProtocolAuthPreset {
  /** 无论是否配置密钥都要附加的固定头，例如 Anthropic 的版本头。 */
  readonly fixedHeaders: Readonly<Record<string, string>>
  /** 密钥的默认落点；null 表示该协议只需固定头。 */
  readonly headerName: string | null
  /** 密钥值前缀，例如 `Bearer `。 */
  readonly valuePrefix: string
}

export const PROTOCOL_AUTH_PRESETS: Readonly<Record<Protocol, ProtocolAuthPreset>> = {
  'openai-completions': { fixedHeaders: {}, headerName: 'authorization', valuePrefix: 'Bearer ' },
  'openai-responses': { fixedHeaders: {}, headerName: 'authorization', valuePrefix: 'Bearer ' },
  'anthropic-messages': {
    fixedHeaders: { 'anthropic-version': '2023-06-01' },
    headerName: 'x-api-key',
    valuePrefix: '',
  },
}

/**
 * 构造指定协议的认证头。
 *
 * 固定头**永远**附加：它们描述的是协议的形态而不是密钥的落点（Anthropic 的
 * `anthropic-version` 缺了就是 400，跟密钥放在哪个头里毫无关系）。
 * 自定义认证头只改变「密钥由谁承载」，不改变「这个协议需要哪些头」。
 */
export function createProtocolAuthHeaders(protocol: Protocol, apiKey: string | null, customAuthHeader: string | null): Record<string, string> {
  const preset = PROTOCOL_AUTH_PRESETS[protocol]
  if (apiKey !== null && customAuthHeader !== null && customAuthHeader !== '') return { ...preset.fixedHeaders, [customAuthHeader]: apiKey }
  if (apiKey === null || preset.headerName === null) return { ...preset.fixedHeaders }
  return { ...preset.fixedHeaders, [preset.headerName]: `${preset.valuePrefix}${apiKey}` }
}
