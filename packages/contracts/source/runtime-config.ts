/**
 * 运行时配置契约。
 *
 * `RuntimeProfile` 是**预设**（development / production 两档默认值），`RuntimeConfig`
 * 是宿主算完之后交给 core 的**完整配置**。core 只接受后者：它不需要知道默认端口是
 * 怎么来的，也不需要知道数据目录在哪个平台该长什么样——那些都是宿主适配的事
 * （见 `product/packaging.md` §5.5）。
 *
 * 这个文件刻意不 import 任何 Node 内置模块：默认数据目录要用 `node:os` / `node:path`，
 * 那是宿主侧的活（App 用 `app.setPath('userData', ...)`，CLI 用
 * `apps/cli/source/host.ts`），不是契约的一部分。
 *
 * 这里也**没有**数据文件名：两个库各自带 schema 版本常量，文件名由
 * `@common/database-file` 从版本号推导（见那个文件的说明）。宿主少算一次文件名，
 * 就少一个两种形态可能算出不同结果的地方。
 */

import { getRuntimeProfile, type RuntimeEnvironment } from './runtime-profile'

export interface RuntimeConfig {
  environment: RuntimeEnvironment
  /** 数据目录（两个数据库、运行时文件、本地密钥文件都落在这里）。 */
  dataDir: string
  /** 代理监听地址的**默认值**；实际上由设置里的 `listenHost` 决定。 */
  proxyHost: string
  /** 代理监听端口的**默认值**；实际上由设置里的 `listenPort` 决定。 */
  proxyPort: number
  /** 管理服务的监听地址。它不是一个可持久化设置，所以这里给的就是实际值。 */
  managementHost: string
  /** 管理服务的监听端口。同上，给的就是实际值。 */
  managementPort: number
  /** 是否由管理服务托管控制台静态产物。 */
  serveWeb: boolean
  /** 控制台静态产物根目录；`serveWeb` 为真时必须给出。 */
  webRoot: string | null
}

export interface CreateRuntimeConfigInput {
  environment: RuntimeEnvironment
  dataDir: string
  serveWeb?: boolean
  webRoot?: string | null
  proxyHost?: string
  proxyPort?: number
  managementHost?: string
  managementPort?: number
}

/**
 * 把宿主的输入合并到预设上。
 *
 * 显式给了就用显式的，没给就落预设——这样「用户没传参数」与「用户传了和预设相同的值」
 * 走同一条路，不需要两套分支。
 */
export function createRuntimeConfig(input: CreateRuntimeConfigInput): RuntimeConfig {
  const profile = getRuntimeProfile(input.environment)
  return {
    environment: input.environment,
    dataDir: input.dataDir,
    proxyHost: input.proxyHost ?? '127.0.0.1',
    proxyPort: input.proxyPort ?? profile.proxyPort,
    managementHost: input.managementHost ?? '127.0.0.1',
    managementPort: input.managementPort ?? profile.managementPort,
    serveWeb: input.serveWeb ?? false,
    webRoot: input.webRoot ?? null,
  }
}
