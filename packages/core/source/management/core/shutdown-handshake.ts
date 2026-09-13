/**
 * 优雅退出握手。
 *
 * CLI 的 `stop` 需要「请另一个进程优雅退出」，而它不能靠信号：Windows 上 `SIGTERM`
 * 是硬杀，数据库与监听端口都来不及收尾。所以走本机 HTTP 握手——运行时文件里放一个
 * 每次启动随机生成的 token，`POST /api/runtime/shutdown` 带对了才认。
 *
 * 这不是一套鉴权体系，只是「本机同一个人」的证明：默认只监听 127.0.0.1，且 token
 * 只写在本机数据目录里。桌面形态不配置它，端点直接当作不存在。
 */

export interface ShutdownHandshake {
  /** 每次启动随机生成，随运行时文件落盘。 */
  token: string
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
