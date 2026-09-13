import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { log } from './lib/log.mjs'
import { run } from './lib/run.mjs'

// 一次覆盖全部包：`tsconfig.check.json`（本包根目录）把五棵 `source` 树与构建配置
// 放在同一个程序里。逐包做类型检查需要每个包自己声明 paths，收益不大，
// 反而多出四个会腐烂的配置。
//
// 配置与本脚本同属一个包：两个文件都是「只有这个脚本会读」的东西，
// 放在一起才能一眼看出它们谁是消费者、谁是被读的。
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const configDirectory = path.resolve(repositoryRoot, 'packages/toolkit')
const configPath = path.join(configDirectory, 'tsconfig.check.json')

// `tsc` 对 `include` 里指向空气的条目**静默成功**：既不报错也不提示，只是那份文件不再被检查。
// 于是「改文件名忘了改 include」的表现是零反馈——`packages/core/drizzle.config.ts` 被拆成两个文件后
// 就从检查范围里消失了三个版本，谁都没发现。校验自己的输入不算额外机制。
const assertIncludeTargetsExist = () => {
  // 这份配置刻意带注释，JSON.parse 之前先剥掉整行注释。
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\s*\/\/.*$/gm, ''))
  const missing = config.include
    .map((entry) => path.resolve(configDirectory, entry))
    // glob 只校验静态前缀：`.../source/**/*.ts` 要能定位到 `.../source`。
    .map((target) => [target, target.split('*')[0]])
    .filter(([, staticPrefix]) => !fs.existsSync(staticPrefix))
    .map(([target]) => target)

  if (missing.length > 0) {
    log.error('tsconfig.check.json 里有指向空气的 include 条目（tsc 不会报错，只是不再检查它们）：')
    for (const target of missing) log.info(path.relative(repositoryRoot, target))
    process.exit(1)
  }
}

const main = async () => {
  log.title('Type checking')
  assertIncludeTargetsExist()
  try {
    await run('pnpm', ['exec', 'tsc', '--noEmit', '-p', 'packages/toolkit/tsconfig.check.json'], { cwd: repositoryRoot })
    log.success('Type check passed')
  } catch (error) {
    log.error('Type check failed')
    process.exit(1)
  }
}

main()
