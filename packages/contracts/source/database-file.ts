/**
 * 数据文件名规则。
 *
 * 一个数据目录里有**两个**数据库，各自带自己的 schema 版本号：
 *
 *   - `one-switch-config-v1.db`——配置库，用户写的东西（供应商、模型、路由、改写规则、设置）；
 *   - `one-switch-data-v1.db`——数据库，系统写的东西（请求日志、用量、正文、运行时日志、健康状态）。
 *
 * 版本号**不跟应用版本号走**：两个库的换代必须能独立发生，也必须与应用版本解耦。用户要
 * 「配置更安全、加载更快」，前提就是「数据库可以整个删掉重建而配置一行不动」；只要还共用一个
 * 来自 `app.getVersion()` 的版本号，一次纯 UI 版本发布就会同时换掉两个文件——那正是要避免的事。
 * schema 版本本来描述的也是「这个文件的表结构只能是这一版」，与应用版本无关。
 *
 * 换代就是换名字：加一之后新版本去开一个全新文件，旧文件原样留在磁盘上，既不读也不删，
 * 所以既不需要写迁移，也不需要任何版本检测代码。见 `product/data-model.md` 的数据库初始化策略。
 */
export const DATABASE_FILE_PREFIX = 'one-switch'

/**
 * 数据库角色。
 *
 * `config` 与 `data` 之间**不存在**外键、JOIN 与事务：这是拆成两个文件的前提，也是拆开
 * 之后必须一直成立的不变量，由 `packages/core/scripts/check-database-boundaries.mjs`
 * 静态守住。
 */
export type DatabaseRole = 'config' | 'data'

export const DATABASE_ROLES: readonly DatabaseRole[] = ['config', 'data']

/**
 * 各库当前的 schema 版本。
 *
 * 改结构时手动加一：这是「这个文件里的表结构只能是这一版」的声明，不是从代码推导出来的。
 * 必须与 schema 定义在同一个提交里改。
 */
export const DATABASE_SCHEMA_VERSIONS: Record<DatabaseRole, number> = {
  config: 1,
  data: 1,
}

/** 数据文件名：`one-switch-config-v1.db` / `one-switch-data-v1.db`。 */
export function createDatabaseFileName(role: DatabaseRole): string {
  return `${DATABASE_FILE_PREFIX}-${role}-v${DATABASE_SCHEMA_VERSIONS[role]}.db`
}

/** 本版本会打开的全部数据文件名（= 启动横幅里列出的那两个）。 */
export function listCurrentDatabaseFileNames(): string[] {
  return DATABASE_ROLES.map(createDatabaseFileName)
}
