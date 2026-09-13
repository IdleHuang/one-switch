import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { log } from '../../../packages/toolkit/scripts/lib/log.mjs'

// 把同一个版本号写进根 manifest 与全部 workspace 包。
//
// 为什么需要它：版本号有三个消费方，而且都在构建期读取而不是运行期查询——
// ① 渲染层的 `__APP_VERSION__`（`packages/console/vite.config.ts` 读根 manifest）
// ② Electron 的 `app.getVersion()`（读 `apps/app/package.json`，electron-builder 也用它做产物名）
// ③ 命令行宿主的 `__CLI_VERSION__` 与 `one-switch version`（`apps/cli`）
// 三者不一致的后果不是报错而是「看起来正常但不对」：更新器的产物名会对不上，
// 界面上显示的版本也不是实际跑的那个。所以只留一个入口。
//
// 数据文件名刻意不在这里：文件名带的是**数据库结构版本**（见
// `packages/contracts/source/database-file.ts`），与发布版本无关。若它跟着应用主版本走，
// 一次应用大版本升级就会让用户的配置在界面上凭空消失。
//
// 为什么住在 app 而不是仓库根：三个消费方里有两个（electron-builder 的产物名、`app.getVersion()`）
// 属于桌面宿主，版本号是发布链的输入，所以这个脚本跟着发布链走。

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

const workspaceDirectories = [
  'apps/app',
  'apps/cli',
  'packages/core',
  'packages/console',
  'packages/toolkit',
  'packages/contracts',
]

const version = process.argv[2]

if (!version) {
  log.error('Usage: pnpm version:set <version>')
  process.exit(1)
}

if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  log.error(`Not a valid semver version: ${version}`)
  process.exit(1)
}

const manifestPaths = [
  path.join(repositoryRoot, 'package.json'),
  ...workspaceDirectories.map(directory => path.join(repositoryRoot, directory, 'package.json')),
]

log.title(`Setting version to ${version}`)

for (const manifestPath of manifestPaths) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  const previousVersion = manifest.version
  manifest.version = version
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  log.info(`${path.relative(repositoryRoot, manifestPath).replaceAll(path.sep, '/')}: ${previousVersion} → ${version}`)
}

log.success('Version updated')
