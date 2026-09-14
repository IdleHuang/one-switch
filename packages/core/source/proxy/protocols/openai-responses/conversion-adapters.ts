import type { Protocol } from '@common/schemas'
import type { RequestContext } from '@server/proxy/request/request-context'
import type { ProtocolConversionAdapter, StreamConverter } from '../shared/types'
import type { ToolNameRegistry } from '../shared/tool-name-registry'
import { convertRequestBody } from '../shared/request-conversion'
import { convertResponseBody, createSseConverter } from '../shared/response-conversion'
import { applyOpenAiCompletionsRequestDefaults } from '../openai-completions/request-defaults'

/**
 * Responses ↔ Chat Completions 是唯一需要请求上下文的转换方向：Responses 的
 * `namespace` 工具组被展平成 Chat 的工具名（见 `../shared/tool-name-registry.ts`），
 * 响应侧要靠同一张表把名字还原回 `(namespace, name)`。
 *
 * 注意适配器是全局单例，`toolNames` 只能随调用透传，不能挂到 `this` 上。
 */
export class OpenAiResponsesToOpenAiCompletionsAdapter implements ProtocolConversionAdapter {
  readonly kind = 'conversion' as const
  readonly clientProtocol: Protocol = 'openai-responses'
  readonly endpointProtocol: Protocol = 'openai-completions'
  readonly requiresResponseConversion = true as const

  prepareRequest(context: RequestContext, providerModelName: string, toolNames?: ToolNameRegistry): Buffer {
    const converted = convertRequestBody(this.clientProtocol, this.endpointProtocol, context.requestBody, providerModelName, toolNames)
    return applyOpenAiCompletionsRequestDefaults(converted)
  }

  createStreamConverter(toolNames?: ToolNameRegistry): StreamConverter {
    return createSseConverter(this.clientProtocol, this.endpointProtocol, toolNames)
  }

  finishStream(converter: StreamConverter): string {
    return converter.push('') + converter.flush() + (converter.finish?.() ?? '')
  }

  convertResponse(body: Buffer, toolNames?: ToolNameRegistry): Buffer {
    return convertResponseBody(this.clientProtocol, this.endpointProtocol, body, toolNames)
  }
}
