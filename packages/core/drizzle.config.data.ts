import { defineConfig } from 'drizzle-kit'

// 见 `drizzle.config.config.ts`：两个库 = 两份配置 = 两套迁移目录，
// 且路径必须写相对 cwd 的 posix 形式。
//
// 这份是 **观测库**：请求日志、尝试、用量、正文、运行时日志、健康状态。
// 这里的每一张表都允许被清空并重来，所以它可以单独清理、单独回收磁盘，
// 也不会把用户的配置拖下水。
export default defineConfig({
  dialect: 'sqlite',
  out: './drizzle/data',
  schema: './source/database/data-schema.ts',
})
