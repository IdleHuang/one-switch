/**
 * 管理 API 的入口守卫：路径、方法、CORS 与**凭证**。
 *
 * 凭证是这里唯一的访问控制。管理 API 监听回环并不等于安全：本机浏览器里任意一个网页
 * 都能向 `127.0.0.1` 发请求，同源策略只挡「读响应」、不挡「发请求」，而这些端点里有
 * 「导出明文密钥」「读写请求正文」这种级别的东西。所以每个 `/api/*` 都必须带
 * `x-one-switch-token`（见 `../../runtime/runtime-identity.ts`），包括优雅退出端点——
 * 它以前是唯一被特判的那个，而那次特判之所以「能用」，靠的只是 CORS 头里恰好漏了
 * 这个自定义头。那种「看起来是刻意设计」的侥幸正是要拆掉的东西。
 *
 * CORS 反过来收窄成白名单：只回显 `null`（渲染进程经 `file://` 加载时的 opaque origin）
 * 与 loopback 上的 origin（开发期的 Vite server）。凭证才是边界，CORS 只是让正常形态
 * 能用、顺手让「别的站点」连响应也读不到。
 */

import { getRuntimeIdentity, matchesRuntimeToken } from '../../runtime/runtime-identity'
import { sendError } from './response'
import type { IncomingMessage, ServerResponse } from 'node:http'

const TOKEN_HEADER = 'x-one-switch-token'

export async function applyManagementRequestGuards(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const method = req.method
  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname

  setCorsHeaders(req, res)

  if (method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return false
  }

  if (!pathname.startsWith('/api/')) {
    sendError(res, 'RESOURCE_NOT_FOUND', `Management API path not found: ${pathname}`, 404, { path: pathname })
    return false
  }
  if (method !== 'POST') {
    sendError(res, 'METHOD_NOT_ALLOWED', `Only POST is supported, received ${method ?? 'UNKNOWN'}`, 405, { method: method ?? 'UNKNOWN' })
    return false
  }

  return authorize(req, res, pathname)
}

/**
 * 校验实例 token。
 *
 * 身份还没建立就放行会退化成「没有鉴权」，所以这种情况**拒绝**并留下 error 级日志：
 * 那是服务生命周期里的编程错误（`ServerRuntime.start()` 一定先建身份再起监听），
 * 不该被当成「测试环境无所谓」悄悄吞掉。
 */
function authorize(req: IncomingMessage, res: ServerResponse, pathname: string): boolean {
  const identity = getRuntimeIdentity()
  if (identity === null) {
    console.error(`[management] rejected path=${pathname} reason=no-runtime-identity`)
    sendError(res, 'INTERNAL_ERROR', 'Management API is not authenticated yet', 503)
    return false
  }

  const header = req.headers[TOKEN_HEADER]
  const provided = Array.isArray(header) ? header[0] ?? null : header ?? null
  if (!matchesRuntimeToken(provided, identity.token)) {
    console.warn(`[management] rejected path=${pathname} reason=invalid-token`)
    sendError(res, 'FORBIDDEN', 'Invalid or missing instance token', 403)
    return false
  }

  return true
}

/**
 * 只对「本机页面」回显 CORS 头。
 *
 * `Origin: null` 是渲染进程从 `file://` 加载时浏览器发的东西（页面是 opaque origin，
 * 只能这么表达自己），生产形态就靠它拿到读响应的许可。除此之外只放行 loopback——
 * 开发期控制台跑在 Vite server 上，是货真价实的跨源请求。
 *
 * 不认识来源时**不回任何 CORS 头**：浏览器会挡住响应。请求本身可以发出来，但带了
 * 错 token 也一样被 403，所以这里不是安全边界，没必要为它写复杂的拒绝逻辑。
 */
function setCorsHeaders(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin
  if (typeof origin !== 'string' || !isLocalOrigin(origin)) return

  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Vary', 'Origin')
  // 刻意**不**列出 `x-one-switch-token`：凭证不该由 CORS 协商，浏览器别去问。
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
}

function isLocalOrigin(origin: string): boolean {
  if (origin === 'null') return true
  try {
    const { protocol, hostname } = new URL(origin)
    if (protocol !== 'http:' && protocol !== 'https:') return false
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1'
  } catch {
    return false
  }
}
