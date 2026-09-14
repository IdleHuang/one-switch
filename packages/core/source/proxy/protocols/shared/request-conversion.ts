import type { Protocol } from '@common/schemas'
import { findRequestDirection } from './conversion-registry'
import { ToolNameRegistry } from './tool-name-registry'

type Json = Record<string, unknown>

// ========== 请求转换入口（仅跨协议） ==========

/**
 * 将 clientProtocol 的请求体转换为 endpointProtocol 的请求体。
 * model 字段会被替换为 ProviderModel 的远端模型名称。
 * 不支持的转换方向抛出 Error。
 *
 * `toolNames` 是本次尝试的转换上下文，由调用方（`attempt-executor.ts`）创建并在响应侧复用：
 * 请求转换往里面登记展平的命名空间工具名，响应转换据此还原。省略时等价于「不记录上下文」。
 *
 * 方向表在 `conversion-registry.ts`：本函数只做「同协议拒绝 + JSON 编解码 + 查表」，
 * 新增方向不需要改动这里。
 */
export function convertRequestBody(clientProtocol: Protocol, endpointProtocol: Protocol, requestBody: Buffer, providerModelName: string, toolNames: ToolNameRegistry = new ToolNameRegistry()): Buffer {
  if (clientProtocol === endpointProtocol) {
    throw new Error(`Same-protocol requests must not enter the conversion path: ${clientProtocol}`)
  }

  const direction = findRequestDirection(clientProtocol, endpointProtocol)
  if (!direction) {
    throw new Error(`Unsupported protocol conversion direction: ${clientProtocol} -> ${endpointProtocol}`)
  }

  const payload = JSON.parse(requestBody.toString('utf8')) as Json
  return Buffer.from(JSON.stringify(direction.convert(payload, providerModelName, toolNames)))
}
