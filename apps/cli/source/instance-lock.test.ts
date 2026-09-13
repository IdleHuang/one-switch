import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { acquireInstanceLock, clearStaleInstanceLock, lockFilePath, readLockHolder, releaseInstanceLock } from './instance-lock'
import { isProcessAlive } from './runtime-state'

// 全程用临时目录：这个模块写的是磁盘上的真实文件，绝不能碰开发机上的数据目录。

const DEAD_PID = 2_147_483_646

let dataDir: string

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'one-switch-lock-'))
})

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true })
})

function writeLockFile(holder: unknown, raw?: string): void {
  fs.writeFileSync(lockFilePath(dataDir), raw ?? JSON.stringify(holder))
}

describe('acquireInstanceLock', () => {
  it('creates the lock and records the current process', async () => {
    const result = await acquireInstanceLock(dataDir)
    expect(result.ok).toBe(true)
    expect((await readLockHolder(lockFilePath(dataDir)))?.pid).toBe(process.pid)
  })

  it('creates missing directories on the way', async () => {
    const nested = path.join(dataDir, 'deep', 'deeper')
    expect((await acquireInstanceLock(nested)).ok).toBe(true)
  })

  it('refuses a second instance while the holder is alive', async () => {
    await acquireInstanceLock(dataDir)

    const second = await acquireInstanceLock(dataDir)
    expect(second).toMatchObject({ ok: false, reason: 'held' })
    // 别人的锁不能动：删掉它等于人为打开双实例的口子。
    expect(fs.existsSync(lockFilePath(dataDir))).toBe(true)
  })

  it('takes over a lock left behind by a dead process', async () => {
    writeLockFile({ pid: DEAD_PID, startedAt: new Date(0).toISOString() })

    const result = await acquireInstanceLock(dataDir)
    expect(result.ok).toBe(true)
    expect((await readLockHolder(lockFilePath(dataDir)))?.pid).toBe(process.pid)
  })

  it('waits out an empty lock file instead of stealing it', async () => {
    // 创建与写入之间必然有一瞬是空文件；这一瞬被当成残留，两个进程就都会以为自己拿到了锁。
    writeLockFile(null, '')

    expect(await acquireInstanceLock(dataDir)).toMatchObject({ ok: false, reason: 'indeterminate' })
  })

  it('takes over an unreadable lock file once it is clearly stale', async () => {
    writeLockFile(null, '{"pid": "not a number"}')
    const past = new Date(Date.now() - 60_000)
    fs.utimesSync(lockFilePath(dataDir), past, past)

    expect((await acquireInstanceLock(dataDir)).ok).toBe(true)
  })

  it('lets go of the lock when released', async () => {
    const result = await acquireInstanceLock(dataDir)
    if (!result.ok) throw new Error('expected the lock')

    await result.release()
    expect(fs.existsSync(lockFilePath(dataDir))).toBe(false)
    expect((await acquireInstanceLock(dataDir)).ok).toBe(true)
  })

  it('survives being released twice', async () => {
    const result = await acquireInstanceLock(dataDir)
    if (!result.ok) throw new Error('expected the lock')

    await result.release()
    await expect(result.release()).resolves.toBeUndefined()
  })
})

describe('releaseInstanceLock', () => {
  it('keeps a lock that belongs to a different process', async () => {
    // 父进程在测试跑完之前一直活着，正好当「别人」：既不是我们的 pid，也确实是活的。
    const foreignPid = process.ppid
    expect(foreignPid).not.toBe(process.pid)
    expect(isProcessAlive(foreignPid)).toBe(true)
    writeLockFile({ pid: foreignPid, startedAt: new Date().toISOString() })

    await releaseInstanceLock(dataDir)
    expect((await readLockHolder(lockFilePath(dataDir)))?.pid).toBe(foreignPid)
  })
})

describe('clearStaleInstanceLock', () => {
  it('removes a lock whose holder is gone', async () => {
    writeLockFile({ pid: DEAD_PID, startedAt: new Date(0).toISOString() })

    await clearStaleInstanceLock(dataDir)
    expect(fs.existsSync(lockFilePath(dataDir))).toBe(false)
  })

  it('keeps a lock whose holder is alive', async () => {
    writeLockFile({ pid: process.ppid, startedAt: new Date().toISOString() })

    await clearStaleInstanceLock(dataDir)
    expect(fs.existsSync(lockFilePath(dataDir))).toBe(true)
  })
})
