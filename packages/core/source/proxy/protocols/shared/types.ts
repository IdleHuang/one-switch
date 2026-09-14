import type { Protocol } from '@common/schemas'
import type { RequestContext } from '@server/proxy/request/request-context'
import type { ToolNameRegistry } from './tool-name-registry'

export interface StreamConverter {
  push(chunk: string): string
  flush(): string
  finish?(): string
}

/**
 * 适配器实例是按方向在模块加载时创建一次并全局复用的（见 `protocols/registry.ts`），
 * 所以适配器**不能**持有请求级状态。请求上下文（`toolNames`）由 `attempt-executor.ts`
 * 按「每次上游尝试」创建，随调用透传进来：同一个实例先给 `prepareRequest`（写），
 * 再给 `createStreamConverter` / `convertResponse`（读）。
 */
interface ProtocolAdapterBase {
  readonly clientProtocol: Protocol
  readonly endpointProtocol: Protocol
  prepareRequest(context: RequestContext, providerModelName: string, toolNames?: ToolNameRegistry): Buffer
}

export interface NativeProtocolAdapter extends ProtocolAdapterBase {
  readonly kind: 'native'
  readonly requiresResponseConversion: false
  createStreamConverter(): null
  finishStream(converter: StreamConverter): string
  convertResponse(body: Buffer): Buffer
}

export interface ProtocolConversionAdapter extends ProtocolAdapterBase {
  readonly kind: 'conversion'
  readonly requiresResponseConversion: true
  createStreamConverter(toolNames?: ToolNameRegistry): StreamConverter
  finishStream(converter: StreamConverter): string
  convertResponse(body: Buffer, toolNames?: ToolNameRegistry): Buffer
}

export type ProtocolAdapter = NativeProtocolAdapter | ProtocolConversionAdapter

export interface ProtocolAdapterRegistry {
  resolve(clientProtocol: Protocol, endpointProtocol: Protocol): ProtocolAdapter
}
