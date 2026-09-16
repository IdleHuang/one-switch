import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// 迁移基线随核心包分发（`packages/core/drizzle`），与实现源码同包但不同目录。
// 两个库各有自己的链：`drizzle/config` 与 `drizzle/data`，drizzle-kit 一份配置只能喂一条链，
// 所以下面每一条不变量都必须在两个目录里分别成立。
const drizzleDirectory = fileURLToPath(new URL('../../drizzle', import.meta.url))
const databaseRoles = ['config', 'data'] as const

interface MigrationSnapshot {
  folder: string
  id: string
  prevIds: string[]
  version: string
  dialect: string
  ddl: unknown[]
}

function roleDirectory(role: (typeof databaseRoles)[number]): string {
  return path.join(drizzleDirectory, role)
}

function listMigrationFolders(role: (typeof databaseRoles)[number]): string[] {
  return fs
    .readdirSync(roleDirectory(role), { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort()
}

function readSnapshots(role: (typeof databaseRoles)[number]): MigrationSnapshot[] {
  return listMigrationFolders(role).map(folder => {
    const raw = JSON.parse(fs.readFileSync(path.join(roleDirectory(role), folder, 'snapshot.json'), 'utf8')) as Omit<
      MigrationSnapshot,
      'folder'
    >
    return { ...raw, folder }
  })
}

// 这些不变量保护的是 drizzle-kit 的 diff 基线选择：
// 缺失 snapshot.json 会让基线回退到更早的状态，而分叉的链（多个叶子）会被当成
// 分支合并，从而生成一份把早已应用过的 DDL 再重放一遍的假迁移。
// 链开始追加迁移之后，这些不变量就是「它必须保持线性」的定义：只有基线允许挂在图外，
// 每个节点最多一个孩子，末节点只能是那条最新的迁移。
describe.each(databaseRoles)('%s migration chain integrity', (role) => {
  const folders = listMigrationFolders(role)

  it('has a migration baseline at all', () => {
    // 少了基线，运行时的 `migrate()` 会静默建出一个空库：所有查询都在启动后才炸。
    expect(folders.length).toBeGreaterThan(0)
  })

  it('keeps migration.sql and snapshot.json together in every folder', () => {
    const incomplete = folders.filter(
      folder =>
        !fs.existsSync(path.join(roleDirectory(role), folder, 'migration.sql')) ||
        !fs.existsSync(path.join(roleDirectory(role), folder, 'snapshot.json')),
    )

    expect(incomplete).toEqual([])
  })

  it('forms one linear snapshot chain with a single tip', () => {
    const snapshots = readSnapshots(role)
    const byId = new Map(snapshots.map(snapshot => [snapshot.id, snapshot]))
    const childCount = new Map(snapshots.map(snapshot => [snapshot.id, 0]))
    const danglingParents: string[] = []

    for (const snapshot of snapshots) {
      const isBaseline = snapshot.folder === folders[0]

      for (const prevId of snapshot.prevIds) {
        if (byId.has(prevId)) {
          childCount.set(prevId, (childCount.get(prevId) ?? 0) + 1)
        } else if (!isBaseline) {
          // 只有基线允许挂在图外（drizzle-kit 用一个全零 id 标记它），其余节点必须真实存在。
          danglingParents.push(snapshot.folder)
        }
      }

      if (!isBaseline) expect(snapshot.prevIds.length).toBeGreaterThan(0)
    }

    expect(danglingParents).toEqual([])
    expect([...childCount.entries()].filter(([, count]) => count > 1)).toEqual([])

    const leaves = snapshots.filter(snapshot => (childCount.get(snapshot.id) ?? 0) === 0)
    expect(leaves.map(snapshot => snapshot.folder)).toEqual([folders[folders.length - 1]])
  })

  it('keeps the baseline a pure create-only migration', () => {
    // 每个库只保留一份由 schema 直接生成的首发基线：出现 ALTER / DROP 就说明文件被手工改过，
    // 或者混进了不该在这里的历史。
    const baselineSql = fs.readFileSync(path.join(roleDirectory(role), folders[0], 'migration.sql'), 'utf8')

    expect(baselineSql).toMatch(/^\s*CREATE TABLE/m)
    expect(baselineSql).not.toMatch(/^\s*(ALTER TABLE|DROP)/m)
  })

  it('writes sqlite version 7 snapshots for every link', () => {
    for (const snapshot of readSnapshots(role)) {
      expect({ folder: snapshot.folder, version: snapshot.version, dialect: snapshot.dialect }).toEqual({
        folder: snapshot.folder,
        version: '7',
        dialect: 'sqlite',
      })
      expect(snapshot.ddl.length).toBeGreaterThan(0)
    }
  })

  it('counts each snapshot node exactly once while walking the chain', () => {
    const snapshots = readSnapshots(role)
    const byId = new Map(snapshots.map(snapshot => [snapshot.id, snapshot]))

    let cursor: MigrationSnapshot | undefined = snapshots[snapshots.length - 1]
    const visited = new Set<string>()
    while (cursor) {
      expect(visited.has(cursor.id)).toBe(false)
      visited.add(cursor.id)
      cursor = cursor.prevIds.map(prevId => byId.get(prevId)).find(Boolean)
    }

    expect(visited.size).toBe(snapshots.length)
  })

  // 文件角色必须与它的链一致：一个只建配置表的链被放进 `data/`，运行时两边的迁移
  // 都会「成功」，然后查询在启动几秒后才因为缺表而失败——那是最难定位的一类故障。
  it('keeps the configuration file free of observability tables and vice versa', () => {
    const sql = folders
      .map(folder => fs.readFileSync(path.join(roleDirectory(role), folder, 'migration.sql'), 'utf8'))
      .join('\n')
    const observabilityTables = ['request_logs', 'request_attempts', 'request_usages', 'runtime_logs', 'provider_health']

    if (role === 'config') {
      for (const table of observabilityTables) expect(sql).not.toContain(`CREATE TABLE \`${table}\``)
    } else {
      expect(sql).not.toContain('CREATE TABLE `providers`')
      expect(sql).not.toContain('CREATE TABLE `logical_models`')
    }
  })
})
