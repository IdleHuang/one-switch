/**
 * 单实例锁。
 *
 * 两个 `start` 指向同一个数据目录是会真出事的：后启动的那个会覆盖 `runtime.json`，
 * 于是先启动的进程**失去身份**——`stop` 再也找不到它，它却还占着端口、还开着同一对
 * SQLite 文件。端口冲突只能挡住「沿用默认端口」的那一半情况，`--proxy-port` 一换就绕过去了。
 *
 * 为什么不能只看 `runtime.json`：那份文件是**监听成功之后**才写的（早写会让 `status`
 * 报出一个还没在跑的实例），两个进程同时走到那个点之前有一段谁都看不见的空窗。锁用
 * `open(path, 'wx')` 的原子创建把这个空窗收掉：并发时只有一个能创建成功。
 *
 * 锁**不长期持有句柄**：Windows 上 `fs` 的默认共享模式允许别的进程删掉它，持有句柄
 * 并不能形成强制锁。所以它是一份「带 pid 的声明」，残留靠 pid 存活判断来识别——
 * 与 `runtime-state.ts` 同一套办法。
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { isProcessAlive } from './runtime-state'

export const LOCK_FILE_NAME = 'instance.lock'

/**
 * 「锁文件刚建出来、内容还没写进去」的宽限期。
 *
 * 创建与写入之间必然有一瞬是空文件。读到空文件时不能立刻当成残留删掉——那会让两个
 * 进程都以为自己拿到了锁。按 mtime 给一小段宽限，超过它才是**真的**残留（上次崩溃
 * 留下的半截文件）。取 5s 是因为这段时间远大于一次本地写入，又远小于人手重试的间隔。
 */
const WRITE_GRACE_MILLISECONDS = 5_000

/** 抢锁的重试次数：每次重试都意味着撞上了一个刚被判定为残留的锁。 */
const MAX_ATTEMPTS = 3

export interface LockHolder {
  pid: number
  startedAt: string
}

export type AcquireLockResult =
  | { ok: true; release: () => Promise<void> }
  | { ok: false; reason: 'held'; holder: LockHolder }
  /** 锁文件存在但读不出持有者，且还没过宽限期——无法判断，按「有人在动」处理。 */
  | { ok: false; reason: 'indeterminate'; filePath: string }

export function lockFilePath(dataDir: string): string {
  return path.join(dataDir, LOCK_FILE_NAME)
}

/**
 * 取锁。成功时返回的 `release` 可重复调用。
 *
 * 失败**不抛异常**：调用方要用不同的文案区分「别人在跑」和「状态不明」，
 * 压成一个异常会让 `start` 只能报一句笼统的「启动失败」。
 */
export async function acquireInstanceLock(dataDir: string): Promise<AcquireLockResult> {
  const filePath = lockFilePath(dataDir)
  await fs.mkdir(dataDir, { recursive: true })

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      await fs.writeFile(filePath, JSON.stringify(holder(), null, 2), { flag: 'wx', mode: 0o600 })
      return { ok: true, release: () => releaseInstanceLock(dataDir) }
    } catch (error) {
      // 只有「已存在」才是预期的竞争结果，其余（权限、只读目录）照旧往上抛。
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }

    const holderState = await readLockHolder(filePath)
    if (holderState === null) {
      if (await isWithinWriteGrace(filePath)) return { ok: false, reason: 'indeterminate', filePath }
      // 过了宽限期还读不出来：上次崩溃留下的半截文件，清掉重试。
      await removeLockFile(filePath)
      continue
    }

    if (isProcessAlive(holderState.pid)) return { ok: false, reason: 'held', holder: holderState }

    // 持有者已经不在：崩溃或被强杀留下的锁。
    await removeLockFile(filePath)
  }

  // 重试耗尽说明竞争异常激烈（或每次清掉都立刻被别人抢走）。报「状态不明」而不是
  // 「有人在跑」——我们确实不知道谁在跑，让调用方给出「再试一次」的指引。
  return { ok: false, reason: 'indeterminate', filePath }
}

/**
 * 释放锁。
 *
 * 释放前先确认持有者还是自己：`stop` 清掉残留后可能已经有新实例抢到了锁，
 * 那时把别人的锁删掉会直接打开「双实例」的口子。
 */
export async function releaseInstanceLock(dataDir: string): Promise<void> {
  const filePath = lockFilePath(dataDir)
  const holderState = await readLockHolder(filePath)
  if (holderState !== null && holderState.pid !== process.pid) return
  await removeLockFile(filePath)
}

/**
 * 清掉一个**已经没有持有者**的锁（`stop` 处理残留时用）。
 *
 * 与 `releaseInstanceLock` 的区别是它不要求「持有者是我」：调用方是另一个进程，
 * 本来就不该用自己 pid 去比对。但也不能无条件删——真有一个活着的实例占着锁时删掉，
 * 就等于人为打开了双实例的口子。所以判定标准与取锁时一致：pid 已死才删。
 */
export async function clearStaleInstanceLock(dataDir: string): Promise<void> {
  const filePath = lockFilePath(dataDir)
  const holderState = await readLockHolder(filePath)
  if (holderState !== null && isProcessAlive(holderState.pid)) return
  await removeLockFile(filePath)
}

/** 只读地看一眼当前持有者（`status` 与测试用）。 */
export async function readLockHolder(filePath: string): Promise<LockHolder | null> {
  let raw: string
  try {
    raw = await fs.readFile(filePath, 'utf8')
  } catch {
    return null
  }
  try {
    const value = JSON.parse(raw) as unknown
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
    const record = value as Record<string, unknown>
    if (typeof record.pid !== 'number' || typeof record.startedAt !== 'string') return null
    return { pid: record.pid, startedAt: record.startedAt }
  } catch {
    return null
  }
}

function holder(): LockHolder {
  return { pid: process.pid, startedAt: new Date().toISOString() }
}

async function isWithinWriteGrace(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath)
    return Date.now() - stat.mtimeMs < WRITE_GRACE_MILLISECONDS
  } catch {
    // stat 失败说明文件在我们看它之前就没了：那它就不是「有人在写」，可以直接重试。
    return false
  }
}

async function removeLockFile(filePath: string): Promise<void> {
  try {
    await fs.rm(filePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}
