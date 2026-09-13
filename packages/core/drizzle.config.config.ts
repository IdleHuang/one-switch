import { defineConfig } from 'drizzle-kit'

// 一个包只能有一份名为 `drizzle.config.ts` 的配置（drizzle-kit 的 `defineConfig` 只接受单个
// 配置对象，不认数组），而这里有两个物理文件、两套互不相干的迁移历史，所以拆成两份配置、
// 两个 `out` 目录，统一由 `scripts/db.mjs` 一条命令跑两遍 —— 漏跑一个库比没有库更难查。
//
// 路径写成相对 cwd 的 posix 形式：`scripts/db.mjs` 会把 cwd 切到 `packages/core`，
// 而 Windows 上 `fileURLToPath` 产出的反斜杠路径会被 drizzle-kit 的路径匹配吞掉
// （实测直接报 "No schema files found for path config"）。
//
// 这份是 **配置库**：只装用户写进去、系统不能自己重建的东西
// （供应商 / 模型 / 端点 / 协议转换 / 路由规则 / 工作流 / 设置）。
export default defineConfig({
  dialect: 'sqlite',
  out: './drizzle/config',
  schema: './source/database/config-schema.ts',
})
