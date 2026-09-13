/**
 * 运行时状态文件。
 *
 * `stop` / `status` 是**另一个进程**，它们要知道服务在哪儿、pid 是多少、优雅退出的 token
 * 是什么，只能靠磁盘上的这份快照。桌面形态不需要它：那是进程内状态，落盘只会多一份要维护的副本。
 *
 * 读取方一律把「读不出来」当成「没有实例在跑」——文件可能被手工删掉、写坏，也可能是更早的
 * 版本留下的。这是**正常状态**，不是错误，`stop` 与 `status` 都按「未运行」继续往下走。
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import type { RuntimeEnvironment } from '@common/runtime-profile'

export const RUNTIME_FILE_NAME = 'runtime.json'

export interface RuntimeFileState {
  /** 写入它的进程 pid。用它区分「进程已经没了」与「进程活着但不答应」。 */
  pid: number
  appVersion: string
  environment: RuntimeEnvironment
  managementHost: string
  managementPort: number
  /** 实际生效的代理地址（可能来自设置，不一定是本次启动传的值）。 */
  proxyHost: string
  proxyPort: number
  /** 托管控制台时的访问地址；`--no-web` 时为 `null`。 */
  webUrl: string | null
  /** 优雅退出握手的 token，见 core 的 `management/core/shutdown-handshake.ts`。 */
  shutdownToken: string
  /** ISO 8601。 */
  startedAt: string
}

export function runtimeFilePath(dataDir: string): string {
  return path.join(dataDir, RUNTIME_FILE_NAME)
}

export async function readRuntimeState(dataDir: string): Promise<RuntimeFileState | null> {
  let raw: string
  try {
    raw = await fs.readFile(runtimeFilePath(dataDir), 'utf8')
  } catch (error) {
    // 文件不存在是正常状态：从没启动过，或者上一次退出时已经清理干净。
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    // 权限之类的读取失败是真异常，往上抛——静默当成「没在运行」会掩盖环境问题。
    throw error
  }
  return parseRuntimeState(raw)
}

/**
 * 原子写。
 *
 * `stop` 随时可能来读，必须让它读到「旧的完整内容」或「新的完整内容」，不能是写了一半的
 * JSON。落盘权限 0600：里面那个 token 就是本机优雅退出的凭证。
 */
export async function writeRuntimeState(dataDir: string, state: RuntimeFileState): Promise<void> {
  const filePath = runtimeFilePath(dataDir)
  await fs.mkdir(dataDir, { recursive: true })
  const temporaryPath = `${filePath}.tmp`
  await fs.writeFile(temporaryPath, JSON.stringify(state, null, 2), { mode: 0o600 })
  await fs.rename(temporaryPath, filePath)
}

export async function removeRuntimeState(dataDir: string): Promise<void> {
  try {
    await fs.rm(runtimeFilePath(dataDir))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

/**
 * 进程是否还在。
 *
 * `kill(pid, 0)` 不发信号，只做存在性检查。`EPERM` 表示进程存在但不属于当前用户——算活着，
 * 否则以 root 启动的实例在普通用户下会被误判成「已停止」。
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

const STRING_FIELDS = ['appVersion', 'environment', 'managementHost', 'proxyHost', 'shutdownToken', 'startedAt'] as const
const NUMBER_FIELDS = ['pid', 'managementPort', 'proxyPort'] as const

/**
 * 解析并校验。
 *
 * 用不上 schema 库：这份文件是我们自己整体写下去的，字段少且都是标量，缺一个字段就说明
 * 它与当前版本对不上（或者被外部改过），当作「没在运行」处理比将就着用更安全。
 */
function parseRuntimeState(raw: string): RuntimeFileState | null {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null

  const record = value as Record<string, unknown>
  for (const field of STRING_FIELDS) {
    if (typeof record[field] !== 'string') return null
  }
  for (const field of NUMBER_FIELDS) {
    if (typeof record[field] !== 'number') return null
  }
  if (record.webUrl !== null && typeof record.webUrl !== 'string') return null

  return value as RuntimeFileState
}
