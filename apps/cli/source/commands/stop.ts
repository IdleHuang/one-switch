/**
 * `stop`：请另一个进程优雅退出。
 *
 * 只能走 HTTP 握手，不能发信号：Windows 上没有真正的 `SIGTERM`（`process.kill` 是硬杀），
 * 数据库与监听端口都来不及收尾。握手契约见 core 的 `management/core/shutdown-handshake.ts`。
 */

import { waitFor } from '../async'
import { describeError } from '../errors'
import { cliTranslator } from '../native-i18n'
import { resolveDataDirectory } from '../host'
import { callManagementApi } from '../management-client'
import { clearStaleInstanceLock } from '../instance-lock'
import { isProcessAlive, readRuntimeState, removeRuntimeState, runtimeFilePath } from '../runtime-state'
import type { CliArguments } from '../options'

/** 等它退出。超过这个时间就报失败：不猜它「大概快停了」。 */
const SHUTDOWN_TIMEOUT_MILLISECONDS = 10_000

const HTTP_FORBIDDEN = 403

export async function runStop(values: CliArguments): Promise<number> {
  const t = cliTranslator()
  const dataDir = resolveDataDirectory(values.dataDir)
  const filePath = runtimeFilePath(dataDir)
  const state = await readRuntimeState(dataDir)

  /**
   * 连带清掉已经没有持有者的实例锁。
   *
   * 运行时文件与实例锁是「同一个实例」的两种记录：残留往往是两份一起留下，
   * 清一份留一份，下一次 `start` 就会在锁那道门上被自己上一次的崩溃拦住。
   * 内部只删「pid 已死」的锁，所以不会误伤真在跑的实例。
   */
  const clearStaleLock = async (): Promise<void> => {
    try {
      await clearStaleInstanceLock(dataDir)
    } catch (error) {
      console.error('[cli] failed to clear the stale instance lock', error)
    }
  }

  if (!state) {
    // 正常状态：从没启动过，或者上一次已经干净退出。
    console.log(t('native.cli.stop.notRunning', { path: filePath }))
    return 0
  }

  if (!isProcessAlive(state.pid)) {
    // 进程早就不在了——文件是上次异常退出（崩溃、被强杀）留下的。先清理再报告，
    // 否则 `status` 会一直说「无响应」，让人以为还有服务在跑。
    try {
      await removeRuntimeState(dataDir)
    } catch (error) {
      console.error(t('native.cli.stop.failed', { message: describeError(error) }))
      return 1
    }
    await clearStaleLock()
    console.log(t('native.cli.stop.stale', { path: filePath }))
    return 0
  }

  console.log(t('native.cli.stop.requesting', { pid: state.pid }))
  const result = await callManagementApi({
    host: state.managementHost,
    port: state.managementPort,
    path: '/api/runtime/shutdown',
    token: state.shutdownToken,
  })

  // 不按响应判定成败：服务端收尾时会关掉监听，客户端可能在读完响应前就被断开，
  // 于是「已经停了」会被误报成「没人应答」。统一等进程真的消失——它对两种情况都成立。
  const exited = await waitFor(() => !isProcessAlive(state.pid), SHUTDOWN_TIMEOUT_MILLISECONDS)
  if (exited) {
    // 对端自己会释放锁；这里再确认一次，是因为它可能在收尾途中崩掉。
    await clearStaleLock()
    console.log(t('native.cli.stop.done'))
    return 0
  }

  if (result.ok === false && result.reason === 'rejected' && result.status === HTTP_FORBIDDEN) {
    // token 来自运行时文件，不匹配只可能是文件与运行中的实例不是同一份
    // （换过数据目录、或文件被改过）。不清理文件：进程还活着，文件还是它的。
    console.error(t('native.cli.stop.rejected'))
    return 1
  }

  console.error(
    t('native.cli.stop.timeout', { pid: state.pid, seconds: Math.round(SHUTDOWN_TIMEOUT_MILLISECONDS / 1000) }),
  )
  return 1
}
