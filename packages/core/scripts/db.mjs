import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { log } from '../../toolkit/scripts/lib/log.mjs'
import { run } from '../../toolkit/scripts/lib/run.mjs'

const packageDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// 两个库各有一套迁移目录与 drizzle 配置：`drizzle/<role>/` + `drizzle.config.<role>.ts`。
const roles = ['config', 'data']

const usage = `
Usage: pnpm db generate [role]

  Without a role, both databases are generated.

Roles:
  config   Configuration database — user-authored, not regenerable
  data     Observability database — disposable

Migrations are not applied from here: the runtime applies them on startup with
the drizzle-orm migrator, see packages/core/source/database/index.ts.
`

const main = async () => {
  const [command, requestedRole, ...extraArguments] = process.argv.slice(2)

  if (command !== 'generate') {
    log.error(command ? `Unknown command "${command}"` : 'Missing command')
    console.log(usage)
    process.exit(1)
  }

  if (requestedRole !== undefined && !roles.includes(requestedRole)) {
    log.error(`Unknown role "${requestedRole}"`)
    console.log(usage)
    process.exit(1)
  }

  const targets = requestedRole ? [requestedRole] : roles

  try {
    for (const role of targets) {
      log.title(`DB — generate (${role})`)
      // 必须在包目录里跑：配置里的 `out` 与 `schema` 都是相对 cwd 的路径。
      const drizzleArguments = ['exec', 'drizzle-kit', 'generate', `--config=./drizzle.config.${role}.ts`, ...extraArguments]
      await run('pnpm', drizzleArguments, { cwd: packageDirectory })
    }
    log.success(`Done: generate (${targets.join(', ')})`)
  } catch {
    log.error('DB command failed: generate')
    process.exit(1)
  }
}

main()
