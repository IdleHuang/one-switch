import { defineConfig } from 'vite'
import { alias, nodeBuild, nodeDefine, nodeExternals, serviceEntry } from './vite.shared'

// 核心服务进程的构建：独立于主进程与 preload 的第三次构建。
//
// 为什么单开一份而不是塞进主进程那份：两者的**外部化边界**不一样。服务进程里可以正常
// `import 'node:sqlite'`，主进程那份产物则永远不该碰到它——`node:sqlite` 是同步 API，
// 出现在主进程里就等于主进程会卡（这正是这次拆分要根治的事，见 issue #9）。
// 一份配置没法同时表达「这里不许有」和「这里必须有」。
export default defineConfig({
  define: nodeDefine,
  resolve: { alias },
  build: {
    ...nodeBuild,
    rolldownOptions: {
      input: serviceEntry,
      external: nodeExternals,
      platform: 'node',
      output: {
        // 入口名必须固定：`apps/app/source/server-host.ts` 按名字（而不是按入口约定）
        // 找这个文件，所以改这里就必须同步改那边。chunk 可以带 hash。
        entryFileNames: 'service-main.mjs',
        chunkFileNames: 'service-[hash].mjs',
        assetFileNames: 'service-[hash][extname]',
      },
    },
  },
})
