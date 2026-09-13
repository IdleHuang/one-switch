/**
 * 运行时身份。
 *
 * 服务实例启动时生成一份，含 pid、启动时间与一个**每次启动都重新随机**的 token。
 * token 是管理 API 的唯一凭证，放在 core 而不是某个宿主的某个端点上：只监听回环
 * 并不构成访问控制——本机浏览器里任意一个网页都能向 `127.0.0.1` 发请求，同源策略
 * 只挡「读响应」、不挡「发请求」，而管理 API 里既有导出明文密钥，也有读写请求正文。
 *
 * 桌面形态与命令行形态因此共用同一套校验：优雅退出端点只是「带 token 的普通请求」，
 * 不再是唯一被特判的那个（那种特判正是漏洞的来源——`Access-Control-Allow-Headers`
 * 里恰好没有 `x-one-switch-token`，shutdown 才碰巧挡住）。
 *
 * 这**不是**一套多用户鉴权体系：token 由宿主注入自己的渲染层、命令行形态则写进
 * 数据目录的运行时文件（0600）。它面对的是「别的网页」与「别的用户进程顺手打进来」，
 * 不是同机同用户的恶意程序——那种威胁下没有任何本地文件凭证是安全的。
 */

import { randomBytes, timingSafeEqual } from 'node:crypto'

export interface RuntimeIdentity {
  /** 写入它的进程 pid。用于「进程已经没了」与「进程活着但不答应」的区分。 */
  readonly pid: number
  /** ISO 8601。 */
  readonly startedAt: string
  /** 每次启动重新随机；不落日志、不进错误信息。 */
  readonly token: string
}

const TOKEN_BYTES = 32

let identity: RuntimeIdentity | null = null

/**
 * 生成本次运行的 token。重复调用会**换一份新的**，所以只在 `ServerRuntime.start()`
 * 的最前面调用一次。
 */
export function createRuntimeIdentity(): RuntimeIdentity {
  identity = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    token: randomBytes(TOKEN_BYTES).toString('base64url'),
  }
  // 只记「生成了」，绝不记 token 本身——运行日志会进前端页面与导出的日志文件。
  console.info(`[runtime] identity created pid=${identity.pid}`)
  return identity
}

export function clearRuntimeIdentity(): void {
  identity = null
}

export function getRuntimeIdentity(): RuntimeIdentity | null {
  return identity
}

/**
 * 定长比较，避免用比较耗时泄漏 token。
 *
 * 长度不同时 `timingSafeEqual` 会**抛异常**而不是返回 false，所以先比长度：
 * 长度本身不是秘密（这里固定 43 个 base64url 字符），提前返回不构成泄漏。
 */
export function matchesRuntimeToken(provided: string | null, expected: string): boolean {
  if (provided === null) return false
  const providedBytes = Buffer.from(provided)
  const expectedBytes = Buffer.from(expected)
  return providedBytes.length === expectedBytes.length && timingSafeEqual(providedBytes, expectedBytes)
}
