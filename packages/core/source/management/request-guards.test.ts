import type { IncomingMessage } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { applyManagementRequestGuards } from './core/request-guards'
import { clearRuntimeIdentity, createRuntimeIdentity, getRuntimeIdentity } from '../runtime/runtime-identity'
import { mockResponse } from './test-support'

interface MockRequestOptions {
  method?: string
  url?: string
  token?: string | null
  origin?: string
}

/**
 * 守卫是管理 API 的**唯一**访问控制点，所以这里逐个断言它的四件事：
 * 路径、方法、CORS 白名单、凭证。丢掉任何一条都等于把端点敞开。
 */
function mockRequest(options: MockRequestOptions): IncomingMessage {
  const headers: Record<string, string> = {}
  if (options.token !== undefined && options.token !== null) headers['x-one-switch-token'] = options.token
  if (options.origin !== undefined) headers.origin = options.origin
  return { method: options.method ?? 'POST', url: options.url ?? '/api/provider/list', headers } as unknown as IncomingMessage
}

afterEach(() => clearRuntimeIdentity())

describe('management request guards', () => {
  it('handles CORS preflight without authentication', async () => {
    const response = mockResponse()

    const accepted = await applyManagementRequestGuards(mockRequest({ method: 'OPTIONS', origin: 'http://localhost:5173' }), response)

    expect(accepted).toBe(false)
    expect(response.statusCode).toBe(204)
    expect(response.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', 'http://localhost:5173')
    // 凭证不该由 CORS 协商，`x-one-switch-token` 刻意不出现在允许头里。
    expect(response.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Headers', 'Content-Type')
    expect(response.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Methods', 'POST, OPTIONS')
    expect(response.end).toHaveBeenCalledOnce()
  })

  it('omits CORS headers for origins that are not the local console', async () => {
    const response = mockResponse()

    await applyManagementRequestGuards(mockRequest({ origin: 'https://example.com' }), response)

    expect(response.setHeader).not.toHaveBeenCalledWith('Access-Control-Allow-Origin', expect.anything())
  })

  it('echoes the opaque origin sent by the file:// renderer', async () => {
    // 生产形态的渲染进程从 `file://` 加载，只能用 `Origin: null` 表达自己。
    const response = mockResponse()

    await applyManagementRequestGuards(mockRequest({ origin: 'null' }), response)

    expect(response.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', 'null')
  })

  it('rejects non-API paths', async () => {
    const response = mockResponse()

    const accepted = await applyManagementRequestGuards(mockRequest({ url: '/not-an-api-path' }), response)

    expect(accepted).toBe(false)
    expect(response.statusCode).toBe(404)
  })

  it('rejects non-POST methods on API paths', async () => {
    const response = mockResponse()

    const accepted = await applyManagementRequestGuards(mockRequest({ method: 'GET' }), response)

    expect(accepted).toBe(false)
    expect(response.statusCode).toBe(405)
  })

  it('accepts POST requests that carry the instance token', async () => {
    const identity = createRuntimeIdentity()
    const response = mockResponse()

    const accepted = await applyManagementRequestGuards(mockRequest({ token: identity.token }), response)

    expect(accepted).toBe(true)
  })

  it('rejects requests without a token', async () => {
    // 只监听回环不是访问控制：本机任意网页都能发出这条请求。
    createRuntimeIdentity()
    const response = mockResponse()

    const accepted = await applyManagementRequestGuards(mockRequest({}), response)

    expect(accepted).toBe(false)
    expect(response.statusCode).toBe(403)
  })

  it('rejects requests that carry a wrong token', async () => {
    const identity = createRuntimeIdentity()
    const response = mockResponse()

    const accepted = await applyManagementRequestGuards(mockRequest({ token: `${identity.token}x` }), response)

    expect(accepted).toBe(false)
    expect(response.statusCode).toBe(403)
  })

  it('fails closed when no runtime identity exists', async () => {
    // 放行会退化成「没有鉴权」，所以宁可拒绝并留下 error 级日志。
    expect(getRuntimeIdentity()).toBeNull()
    const response = mockResponse()

    const accepted = await applyManagementRequestGuards(mockRequest({ token: 'anything' }), response)

    expect(accepted).toBe(false)
    expect(response.statusCode).toBe(503)
  })

  it('guards the runtime shutdown endpoint like any other API path', async () => {
    // 它曾经是唯一被特判的端点，靠的只是 CORS 头里恰好漏了自定义头。
    createRuntimeIdentity()
    const response = mockResponse()

    const accepted = await applyManagementRequestGuards(mockRequest({ url: '/api/runtime/shutdown' }), response)

    expect(accepted).toBe(false)
    expect(response.statusCode).toBe(403)
  })

  it('accepts an OPTIONS preflight even before the identity exists', async () => {
    // 预检不带凭证，也必须答得出来，否则浏览器连请求都发不出去。
    const response = mockResponse()

    const accepted = await applyManagementRequestGuards(mockRequest({ method: 'OPTIONS' }), response)

    expect(accepted).toBe(false)
    expect(response.statusCode).toBe(204)
  })
})
