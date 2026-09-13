import type { ApiResponse } from '@common/schemas'
import { getRuntimeProfile } from '@common/runtime-profile'

interface RequestOptions {
  signal?: AbortSignal
}

/**
 * 管理 API 的基地址。
 *
 * 控制台产物只编一份，却要在三种形态下都能找到管理服务，所以基地址必须在**运行时**算：
 *
 * 1. 宿主显式注入（`window.__ONE_SWITCH__`）——注入了就照办；
 * 2. 页面本身就是管理服务发出来的（`http(s):`）——同源，`/api` 就在旁边，
 *    命令行形态的托管走这条；
 * 3. 其余（Electron 的 `file://`、Vite dev server）——退回构建期预设端口。
 *
 * 顺序里有个坑：Vite dev server 也是 `http:`，但它不是管理服务，同源拼接会指到 5173
 * 上去。所以开发期的判断必须放在同源判断**之前**（见 `product/packaging.md` §5.3）。
 */
let resolvedApiBase: string | null = null

export function resolveApiBase(): string {
  if (resolvedApiBase) return resolvedApiBase

  const profile = getRuntimeProfile(import.meta.env.DEV ? 'development' : 'production')
  resolvedApiBase = resolveApiBaseFromEnvironment(profile.managementApiUrl)
  return resolvedApiBase
}

function resolveApiBaseFromEnvironment(fallback: string): string {
  const injected = typeof window === 'undefined' ? undefined : window.__ONE_SWITCH__?.apiBase
  if (injected) return injected.replace(/\/+$/, '')

  if (import.meta.env.DEV) return fallback

  const location = typeof window === 'undefined' ? undefined : window.location
  if (location && (location.protocol === 'http:' || location.protocol === 'https:')) {
    return `${location.origin}/api`
  }

  return fallback
}

/**
 * 管理 API 的请求头。
 *
 * 每个 `/api/*` 都要求实例 token（见 core 的 `runtime/runtime-identity.ts`）：管理服务
 * 监听回环并不等于安全，本机任意网页都能向 `127.0.0.1` 发请求。token 由宿主注入
 * `window.__ONE_SWITCH__`——桌面形态走 preload，命令行形态由托管静态文件的 core
 * 注入到 `index.html` 里。
 *
 * 拿不到 token 也照发：让服务端回答 403「没有访问权限」，比在前端造一个自己编的错误码
 * 诚实——“页面是从哪儿打开的”直接写进了错误里。
 */
function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = typeof window === 'undefined' ? undefined : window.__ONE_SWITCH__?.token
  if (token) headers['x-one-switch-token'] = token
  return headers
}

export async function request<T>(path: string, body: unknown = {}, options: RequestOptions = {}): Promise<ApiResponse<T>> {
  try {
    const response = await fetch(`${resolveApiBase()}${path}`, {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify(body),
      signal: options.signal,
    })
    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('application/json')) {
      // 诊断消息固定英文；界面按 `errorCode` 本地化（见 `product/i18n.md` §5）。
      return { success: false, errorCode: 'INVALID_RESPONSE', errorMessage: `management service returned a non-JSON response (HTTP ${response.status})` }
    }
    const result = (await response.json()) as ApiResponse<T>
    if (!response.ok && result.success) {
      return { success: false, errorCode: 'HTTP_ERROR', errorMessage: `management service request failed (HTTP ${response.status})` }
    }
    return result
  } catch (error) {
    return { success: false, errorCode: 'NETWORK_ERROR', errorMessage: (error as Error).message }
  }
}
