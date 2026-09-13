/**
 * 优雅退出握手。
 *
 * CLI 的 `stop` 需要「请另一个进程优雅退出」，而它不能靠信号：Windows 上 `SIGTERM`
 * 是硬杀，数据库与监听端口都来不及收尾。所以走本机 HTTP 握手（`POST /api/runtime/shutdown`）。
 *
 * **这里不再是鉴权**：凭证由 `../runtime/runtime-identity.ts` 统一提供，管理 API 的每一个
 * `/api/*` 都要求带上它（见 `./request-guards.ts`）。这个模块只回答一个问题：**本次宿主
 * 是否允许被外部请求停掉**。桌面形态不配置它，端点当作不存在（用户自己点「退出」）；
 * 命令行形态配置它，`stop` 才有办法收尾。
 */

export interface ShutdownHandshake {
  /** 校验通过后的回调。宿主在这里决定何时真正退出（通常是 `stopServer()`）。 */
  onRequest: () => void
}

let handshake: ShutdownHandshake | null = null

export function configureShutdownHandshake(next: ShutdownHandshake | null): void {
  handshake = next
}

export function getShutdownHandshake(): ShutdownHandshake | null {
  return handshake
}
