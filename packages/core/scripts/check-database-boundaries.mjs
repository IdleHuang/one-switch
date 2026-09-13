import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { log } from '../../toolkit/scripts/lib/log.mjs'

// 两个库的边界校验。
//
// 「一个文件只认识一个库」是那种会被顺手违反、而且违反后完全不报错的约束：想查另一边的
// 一行数据，直接 import 另一个句柄就行，编译通过、测试通过，代价要等到「观测数据把配置库
// 的文件撑大」「想单独清空观测库却动到了配置」那类事故才现形。
// 静态检查把这条约束变成可执行的：新增文件自动纳入，例外必须显式登记。
//
// 用静态检查而不是 ESLint 规则，是为了避免和 `peculiar/*` 规则的解析/配置纠缠——
// 这里需要的是「跨文件、跨目录的语义约束」，ESLint 表达不出来。

// 脚本住在 `packages/core/scripts`，所以要往上退三层才是仓库根。
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const sourceRoot = path.join(root, 'packages/core/source')

// 白名单是刻意的、逐条可审计的例外：
//   - 连接层要同时打开、关闭、清理两个库，还负责它们之间的孤儿行清理；
//   - 开发种子要同时往两个库里铺演示数据，否则演示环境就只建了一半。
// 任何新增条目都应该在评审里回答「为什么这里必须同时拿着两个库」。
const ALLOWED = [
  'packages/core/source/database/index.ts',
  'packages/core/source/database/development-seed.ts',
]

/** 所有 `from '...'` / `import('...')` / `require('...')` 的模块说明符。 */
const IMPORT_PATTERN = /(?:from|import\(|require\()\s*'([^']+)'/g

/**
 * SQLite 的 `ATTACH DATABASE` 能让两个库出现在同一个连接里，看起来可以「一起提交」。
 * 但事务仍然只属于各自文件，跨库写入只是两条独立事务——这会写出「看起来原子、实际会半成品」
 * 的代码，比直接写两次更难查。所以从源头上禁掉。
 */
const ATTACH_PATTERN = /ATTACH\s+DATABASE/i

const CONFIG_SCHEMA = 'database/config-schema'
const DATA_SCHEMA = 'database/data-schema'

const CALLS_CONFIG_HANDLE = /\bgetConfigDb\s*\(/
const CALLS_DATA_HANDLE = /\bgetDataDb\s*\(/

async function collectSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await collectSourceFiles(target)))
      continue
    }
    // 测试为了搭夹具可以同时摆弄两个库，边界约束只作用于源码 —— 与 `check-proxy-layers.mjs` 一致。
    if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      files.push(target)
    }
  }
  return files
}

function readSpecifiers(source) {
  const specifiers = []
  for (const match of source.matchAll(IMPORT_PATTERN)) {
    specifiers.push(match[1])
  }
  return specifiers
}

/** 把相对导入规范化成绝对别名，否则 `import './data-schema'` 就能绕开全部规则。 */
function canonicalize(specifier, file) {
  if (!specifier.startsWith('.')) return specifier
  const resolved = path.resolve(path.dirname(file), specifier).replaceAll(path.sep, '/')
  const serverRoot = `${root.replaceAll(path.sep, '/')}/packages/core/source/`
  const commonRoot = `${root.replaceAll(path.sep, '/')}/packages/contracts/source/`
  if (resolved.startsWith(serverRoot)) return `@server/${resolved.slice(serverRoot.length)}`
  if (resolved.startsWith(commonRoot)) return `@common/${resolved.slice(commonRoot.length)}`
  return specifier
}

function touches(specifiers, suffix) {
  return specifiers.some(specifier => specifier === `@server/${suffix}` || specifier.endsWith(`/${suffix}.ts`))
}

async function main() {
  log.title('Database boundary check')

  const files = await collectSourceFiles(sourceRoot)
  const violations = []
  let configOnly = 0
  let dataOnly = 0
  let both = 0

  for (const file of files) {
    const relative = path.relative(root, file).replaceAll(path.sep, '/')
    const source = await readFile(file, 'utf8')
    const specifiers = readSpecifiers(source).map(raw => canonicalize(raw, file))

    const usesConfigSchema = touches(specifiers, CONFIG_SCHEMA)
    const usesDataSchema = touches(specifiers, DATA_SCHEMA)

    if (usesConfigSchema && usesDataSchema) {
      both += 1
      if (!ALLOWED.includes(relative)) {
        violations.push(`${relative}：同时 import 了配置与观测 schema —— 一个文件只该认识一个库`)
      }
    } else if (usesConfigSchema) {
      configOnly += 1
    } else if (usesDataSchema) {
      dataOnly += 1
    }

    if (usesConfigSchema && !usesDataSchema && CALLS_DATA_HANDLE.test(source)) {
      violations.push(`${relative}：只 import 了配置 schema，却调用 getDataDb()`)
    }
    if (usesDataSchema && !usesConfigSchema && CALLS_CONFIG_HANDLE.test(source)) {
      violations.push(`${relative}：只 import 了观测 schema，却调用 getConfigDb()`)
    }
    if (ATTACH_PATTERN.test(source)) {
      violations.push(`${relative}：使用了 ATTACH DATABASE —— 跨库没有事务，这只会写出「看起来原子」的代码`)
    }
  }

  if (violations.length > 0) {
    log.error(`Database boundary check failed（${violations.length} 处越界）`)
    for (const violation of violations) {
      console.log(`  ${violation}`)
    }
    process.exit(1)
  }

  log.info(`config-only: ${configOnly} files`)
  log.info(`data-only: ${dataOnly} files`)
  log.info(`both: ${both} files（白名单 ${ALLOWED.length} 条）`)
  log.success(`Database boundaries respected（${files.length} files）`)
}

main()
