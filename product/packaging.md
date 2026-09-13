# 包结构与多形态分发

> **本文是该主题的唯一权威**：包边界、目录归属、宿主适配点、运行时配置来源、CLI 契约与迁移阶段。
> 其它文档提到同一主题时只写结论加链接，不复述细节。构建命令与打包产物清单以根 `package.json` 的 scripts、各包 `scripts/`（跨包工具在 `packages/toolkit/scripts/`）与各包 `package.json` 为准。

## 1. 目标

同一套核心能力，拆成可独立消费的包，支持两种交付形态（外加作为库直接使用）：

1. **CLI**：`one-switch start` 启动核心服务，同时托管 Web 控制台；用户用浏览器操作，也可以只用 HTTP API。
2. **App**：Electron 只做宿主封装（窗口、托盘、自动更新、系统密钥环），业务能力全部来自核心包。

核心原则：**core 不知道宿主是谁**。宿主差异（密钥存储、Web 托管、桌面能力、语言环境）全部收敛为接口注入，core 内不出现 `electron`、不出现静态文件路径假设。

## 2. 交付形态

| 形态 | 组成 | 入口 | 分发方式 |
| --- | --- | --- | --- |
| 库 | `core` + `contracts` | `import { startServer } from '@one-switch/core'` | npm |
| CLI | `core` + `contracts` + `console` 静态产物 + Node 密钥实现 + 静态托管 | `one-switch start` | npm 全局 bin / `npx` |
| App | `core` + `contracts` + `console` + Electron 壳 | 桌面图标 / 安装包 | electron-builder |

三个形态共用同一份管理 API 契约（见 [tech-architecture.md](./tech-architecture.md)「管理 API 契约」），控制台不做形态分支。

## 3. 包边界

```mermaid
flowchart LR
  contracts["packages/contracts"]
  core["packages/core"]
  console["packages/console"]
  cli["apps/cli"]
  app["apps/app"]

  contracts --> core
  contracts --> console
  core --> cli
  console --> cli
  core --> app
  console --> app
```

工作区分两层，划分依据是「能不能被第三方单独消费」，不是「能不能直接执行」：

- `packages/`：可被外部依赖的库。`contracts`、`core` 是纯逻辑包，第三方可以只装这两个当库用；`console` 的静态产物也可被任意宿主托管。
- `apps/`：宿主壳。`cli` 与 `app` 只做进程生命周期、参数解析与平台能力适配，不被任何包依赖，也不作为库发布。

| 位置 | 包 | 职责 | 硬约束 |
| --- | --- | --- | --- |
| `packages/contracts` | `@one-switch/contracts` | Zod schema、协议表、错误码、i18n 语言目录与核心、`SecretStore` 接口、运行时配置类型、供应商包格式、路由契约类型 | 只描述形状；不依赖 Node 内置模块、不依赖 DOM、不依赖任何其它包 |
| `packages/core` | `@one-switch/core` | runtime / management / proxy / database / infrastructure / security | 纯 Node；**禁止 import `electron`**；不感知 Web 托管与桌面能力 |
| `packages/console` | `@one-switch/console` | React 控制台，构建为静态产物 | 不直接读 `window.electronAPI`；宿主能力统一走平台抽象层 |
| `apps/cli` | `@one-switch/cli` | 命令行入口、Node 密钥实现、静态托管 | 只做宿主适配与参数解析，不写业务逻辑 |
| `apps/app` | `@one-switch/app` | Electron 主进程与 preload | 只做宿主适配，不写业务逻辑 |

依赖方向严格单向：`core` 与 `console` **互不依赖**，二者之间只通过管理 API 通信。

> 约束由静态检查强制（`packages/toolkit/scripts/check-package-boundaries.mjs`，接入 `pnpm lint`），与 `proxy/` 分层检查同一思路：写进文档的规则只有共识价值，能失败的检查才有约束价值。

## 4. 目录结构

### 4.1 目标态

```text
one-switch/
├── packages/
│   ├── contracts/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── source/
│   │       ├── index.ts
│   │       ├── schemas.ts
│   │       ├── protocols.ts
│   │       ├── errors.ts
│   │       ├── secret-store.ts        # SecretStore 接口 + key reference 生成
│   │       ├── runtime-config.ts      # RuntimeConfig 类型与默认值合并
│   │       ├── database-file.ts
│   │       ├── proxy-origin.ts
│   │       ├── provider-bundle.ts
│   │       ├── utils.ts
│   │       ├── i18n/                  # 语言目录、核心、类型
│   │       └── router/                # 路由契约类型与预设
│   │
│   ├── core/
│   │   ├── package.json
│   │   ├── drizzle/                   # 两条迁移链：config/ 与 data/（随包分发）
│   │   └── source/
│   │       ├── index.ts               # 生命周期入口 startServer / stopServer
│   │       ├── runtime/
│   │       ├── management/
│   │       ├── proxy/
│   │       ├── database/
│   │       ├── infrastructure/
│   │       └── security/
│   │
│   ├── console/
│   │   ├── package.json
│   │   ├── index.html
│   │   └── source/
│   │       ├── main.tsx / App.tsx / routes.tsx
│   │       ├── platform/              # 宿主能力抽象（新增）
│   │       ├── api/ features/ pages/ components/ hooks/ store/ services/ i18n/
│   │       └── lib/ infrastructure/
│   │
│   └── toolkit/                       # 跨包开发脚本：lint / test / typecheck / 包边界守卫 / 脚本运行库
│       └── scripts/
│
├── apps/
│   ├── cli/
│   │   ├── package.json               # bin: one-switch
│   │   └── source/
│   │       ├── index.ts               # argv 解析与分发
│   │       ├── commands/              # start / stop / status / config / version
│   │       ├── secret-store.ts        # EncryptedFileSecretStore
│   │       ├── static-server.ts       # 控制台静态托管
│   │       └── native-i18n.ts         # CLI 的终端语言层
│   │
│   └── app/
│       ├── package.json
│       ├── electron-builder.config.cjs
│       ├── build/                     # 应用图标与托盘图标
│       └── source/
│           ├── main/                  # index / tray-* / updater / auto-launch / secret-store / i18n
│           └── preload/
│
├── product/                           # 产品规格文档
├── turbo.json                         # 任务编排与依赖顺序
└── pnpm-workspace.yaml
```

### 4.2 S0 平移映射

S0 只做目录平移与配置同步，不含逻辑改写。实际执行结果：

| 迁移前 | 迁移后 |
| --- | --- |
| `source/common/**` | `packages/contracts/source/**` |
| `source/server/**` | `packages/core/source/**` |
| `drizzle/` | `packages/core/drizzle/` |
| `source/render/index.html` | `packages/console/index.html` |
| `source/render/source/**` | `packages/console/source/**` |
| `source/providers/**` | `packages/console/source/providers/**` |
| `source/command/**` | `apps/app/source/**` |

目录一律叫 `source/`（不用 `src/`）：全仓库源码目录同名后，glob、别名配置与守卫脚本都只有一种写法，也不用为每个包单独记一条例外。

与 §4.1 目标态只剩一处差异，属于刻意延后：`apps/app/source` 保持平铺一层（`index.ts` / `preload.ts` / `tray-*.ts` / `updater.ts` …），不拆 `main/` 与 `preload/`。拆目录会同时改变 Vite 入口、`__dirname` 推导与 preload 相对路径，与「平移零行为风险」冲突，留到 S3。

**别名沿用旧名，只重指目标**（本阶段最关键的取舍）：`@common/*` → `packages/contracts/source`，`@server/*` → `packages/core/source`，`@/*` → `packages/console/source`，`@render/*` → `packages/console`。别名定义分散在三处（`packages/console/vite.config.ts`、`apps/app/vite.shared.ts`、`packages/toolkit/vitest.config.ts`），改路径必须三处同步，否则会出现「测试能过、构建能过、跑起来才炸」的分裂状态。

理由：包内引用约 866 处、跨包引用约 316 处，一次性重写所有 specifier 既无法用类型检查分批验证，也无法在 `moduleResolution: bundler` + 纯源码（无构建产物）的工作区里靠包的 `exports` 字段解析。别名间接层是等价的替代，而且它本身就是后续「按包独立构建」的接缝。真正的 specifier 迁移放到各包开始产出构建产物时再做，届时是机械替换，可验证。

> 现状补充：`contracts` 与 `core` 目前仍以 `exports: "./source/*.ts"` 直接暴露源码，不发构建产物；也就是说别名与 `exports` 两套解析路径目前并存。等 S1 让 core 产出 ESM 产物时，二者应当只留一套。

### 4.3 根级资产的最终归属

S0 之后根目录只保留工作区级配置（`pnpm-workspace.yaml`、`turbo.json`、`tsconfig.json` / `tsconfig.base.json`、`eslint.config.js`、`package.json`）与 `product/`、`release/`。

后来按同一条原则又搬走两份：`vitest.config.ts` 与 `tsconfig.check.json` 的唯一消费方分别是 `packages/toolkit/scripts/test.mjs` 与 `typecheck.mjs`，而 `vitest` 接受 `--config`、`tsc` 接受 `-p`，没有任何工具约定非要它们在根目录，于是两份都住进 `packages/toolkit`（见 §5.8）。反过来，**留在根目录的都不是残留**：`pnpm-workspace.yaml` 决定 workspace 成员，`turbo.json` 由 turbo 在根查找，`tsconfig.json` 是各包 `extends` 的目标，`eslint.config.js` 由 `eslint .` 从 cwd 向上找——把它们搬走才是破坏约定。

原先分散在根目录的资产（包括脚本）按「谁用谁持有」搬进了各自的包：

| 资产 | 现在的位置 | 引用方式 |
| --- | --- | --- |
| 应用图标与托盘图标 | `apps/app/build/` | 源码里用 `?url` 内联（`assetsInlineLimit: Infinity` 让图标变成 data URL，避免 asar 内多一次文件寻址）；electron-builder 的 `icon` 相对 `apps/app` 解析 |
| 打包配置 | `apps/app/electron-builder.config.cjs` | `apps/app/scripts/build.mjs` 显式 `--config`；`directories.output` 指回仓库根 `release/`，`afterPack` 为同包内 `scripts/macos-adhoc-sign.cjs` |
| Electron 与 electron-builder | `apps/app/package.json` 的 devDependencies | 宿主包自己声明。electron-builder 只在 `<projectDir>/node_modules` 里找 Electron（见坑 4），把依赖留在仓库根等于「开发全通、只在打包时失败」 |
| 控制台静态资源 | `packages/console/public/` | Vite 的 `publicDir`，随渲染层构建拷贝进 `packages/console/dist` |
| 各包脚本 | `apps/app/scripts/`、`packages/core/scripts/`、`packages/console/scripts/` | 根 `package.json` 的 scripts 指向包内路径（`apps/app/scripts/{build,dev,version}.mjs`、`packages/core/scripts/{db,check-proxy-layers}.mjs`、`packages/console/scripts/{eslint-plugin-i18n.mjs,vitest.setup.ts}`） |
| 跨包脚本 | `packages/toolkit/scripts/` | 私有工作区包（`@one-switch/toolkit`，无运行时代码）：任务编排（lint / test / typecheck）、版本写入与校验、包边界守卫与脚本运行库。它们不属于任何单一业务包，所以独立成包而不是堆在根目录。同样只被这些脚本读取的 `vitest.config.ts` 与 `tsconfig.check.json` 也住在这里 |
| 打包产物 | `release/<version>/` | 仍在仓库根：它是构建**输出**，不属于任何包的源码 |

搬运时的四个坑：

1. **图标同时被源码级相对路径引用**。`?url` 的解析基准是源码文件而不是配置文件，所以改目录必须连带改源码里的引用，只看配置文件会漏。
2. **`__dirname` 推导需要重新核对**。产物布局是「主进程代码住 `apps/app/dist/command/`，渲染层与迁移基线由 electron-builder 抬进 asar 的 `dist/render` 与 `packages/core/drizzle`」——这三条映射是一组，动一条必须重新验算另外两条。`apps/app/electron-builder.config.cjs` 与 `apps/app/vite.shared.ts` 里各有一段注释专门记录这层约束。
3. **脚本的「仓库根」是数目录数出来的**。脚本用 `import.meta.url` 往上数目录定位仓库根，换目录必须同步改层数，否则它会在错误的 cwd 里跑（症状是「找不到 tsconfig」而不是「找不到脚本」）。同理，跨包引用运行库用相对路径时，层数也跟着目录深度变。
4. **electron-builder 只属于自己的包里找 Electron**。它探测版本的实现是读 `<projectDir>/node_modules/electron/package.json`，**不会逐级向上找**，而打包时的 `projectDir` 就是 `apps/app`。把 Electron 留在仓库根，`pnpm dev`、lint、typecheck、test 全部照常通过，只有真正打包才失败（`Cannot compute electron version from installed node modules`）。同理 `author` 与产物入口 `main` 也得在被打包的那份 `package.json` 里：electron-builder 读的是 app 自己的清单，根清单不再参与。根 `package.json` 保留 `electron` 只剩一个理由——仓库级测试要跑在 Electron 的 Node 里（`node:sqlite` 的 ABI 必须与 app 对齐），那是测试基建的事，不是宿主的事。

结论：原先「随 S3（App 回归）一起处理」的两项已经完成，不再挂账。

## 5. 宿主适配点

以下八项是 `core` 与宿主之间全部的耦合面。除这些之外，`core` 不得感知宿主存在。

### 5.1 密钥存储

现状（已落地）：接口已从 `KeychainApi` 更名为 `SecretStore`（`packages/contracts/source/secret-store.ts`），`generateKeyReference` 保留；两个宿主的实现都已就位。

| 宿主 | 实现 | 说明 |
| --- | --- | --- |
| App | `ElectronSecretStore` | 沿用 `safeStorage.encryptString` / `decryptString`，密文写在数据目录下的 `secrets.json` |
| CLI | `EncryptedFileSecretStore` | 随机 32 字节主密钥存 `secrets.cli.key`（`0600`），逐条 AES-256-GCM 加密写入 `secrets.cli.json` |

CLI 侧的取舍要写清楚：这是**文件级加密**，防止的是备份、误传、被其它用户读到；它不防「同用户同机器上的恶意进程」——那需要系统钥匙串，会引入原生依赖，与「零原生依赖」的约束冲突。接口化之后，未来接入钥匙串只是一个新实现，不改 core。CLI 的实现放在 `apps/cli/source/secret-store.ts`。

**两个形态的文件名故意不同**（`secrets.cli.json` / `secrets.cli.key` vs `secrets.json`），虽然它们落在同一个数据目录里。密文算法不同，同名同址的结果不是「共用密钥」，而是**后写的那个把前一个的条目全部作废**：`safeStorage` 的 base64 密文在命令行侧解不开，命令行的 `v1:iv:tag:ciphertext` 在 `safeStorage` 侧会被当成非法 base64 直接抛错。供应商 key 在服务端只存哈希、作废了不可再生，所以这里必须靠文件名隔开。

代价写在明处：同一个数据目录里两个形态的密钥各存各的，用命令行 Web 控制台配过的 key 在桌面端不会自动出现（反之亦然）。共用的是数据库、设置与日志——供应商条目本身带着 `keyReference`，所以另一边看到的是「这个供应商没配密钥」，而不是静默拿空密钥发请求。要让密钥也真正共用，只能让一边放弃自己的密码学实现（命令行引入原生依赖，或桌面形态把主密钥落到密文旁边），那是安全取舍，不在本轮范围。

设计要点：

- 主密钥文件缺失时自动生成；存在但不可读时**报错而非静默重建**（静默重建等于把用户已有的密钥全部作废）。
- 支持 `ONE_SWITCH_SECRET_KEY`（base64 的 32 字节）覆盖主密钥，服务于容器与 CI；环境变量存在时**不**读写 `secrets.key`，避免两处主密钥共存后互相解不开。
- 密文格式自带版本前缀（`v1:iv:tag:ciphertext`）：以后换算法或换格式时旧数据仍可识别，而不是把新写法当成损坏数据抛异常。

### 5.2 Web 托管

现状（已落地）：管理服务在 `/api` 之外还能托管控制台静态产物，由宿主在 `RuntimeConfig.webRoot` 里传入根目录决定是否启用；App 仍用 `loadFile` 以 `file://` 加载、传 `null`。

托管实现落在 `packages/core/source/management/core/static-web.ts`，两个宿主共享同一份行为。落定下来的细节都只在真实 HTTP 交互下才看得出来，因此都有对应单测（真起 `http.createServer` 并 `listen(0)`，不用假的 `ServerResponse`——它用的是 `createReadStream().pipe(res)`，假对象盖不住流式写入）：

- 入口页不缓存（否则每次升级用户看到的还是旧 HTML），哈希资产一年 immutable。
- SPA fallback 只在「未命中静态文件且不是 `/api/*`」时生效；带扩展名却没命中的路径**不**回退 HTML，否则一个写错的资源路径会返回 `200` + 一段 HTML，浏览器报的错会指向语法而不是「文件不存在」。
- 路径必须限制在根目录内，且同时拦住字面 `../` 与编码后的 `%2e%2e`（两道都要，只做字符串前缀比对会被编码绕过）。
- 只处理 `GET` / `HEAD`，其余方法不接管而是落回原有路由。

- CLI：`--web`（默认开启）时托管控制台产物，`/` 走 SPA fallback（未命中静态文件且不是 `/api/*` 时返回 `index.html`）。
- App：保持 `loadFile`，不启用静态托管（避免多开一个可被局域网访问的入口）。
- 静态根目录由宿主传入（App 用 asar 内路径，CLI 用包内 `dist/web`），core 不硬编码路径。

守卫必须保持：静态托管只挂在管理服务上，默认只监听 `127.0.0.1`。**不做 Host 头白名单校验**：网络可达性交给 `listenHost` 与操作系统防火墙（见 [security-privacy.md](./security-privacy.md)）。这里刻意不叠加第二套应用层白名单——一旦叠上，就只能监听 `localhost` 系名字，「能访问」与「不能访问」的理由就从一处变成两处，而 CLI 形态下用户完全可以自行改 `--host`。

### 5.3 前端运行时注入

现状（已落地）：`packages/console/source/api/client.ts` 在运行时解析 API base，优先级从高到低：

1. `window.__ONE_SWITCH__?.apiBase` —— 宿主注入（Electron preload 注入绝对地址；CLI 托管时注入 `/api`）。
2. `location.protocol` 为 `http:` / `https:` 时用 `${location.origin}/api` —— CLI 同源场景，无需注入也能工作。
3. 回退到内置默认端口 —— 保证 `dev:preview` 与单测不炸。

这一项是 CLI 能跑起来的前提：`file://` 下 `location.origin` 为 `null`，必须靠注入；而 CLI 同源场景则天然可用。

### 5.4 桌面能力抽象

现状（已落地）：`packages/console/source/platform/capabilities.ts` 把宿主能力收敛为一个对象，`update-card.tsx` 不再出现 `window.electronAPI` 字面量：

```ts
interface PlatformCapabilities {
  name: 'electron' | 'web'
  updater: UpdaterApi | null      // web 下为 null，UI 显示「当前形态不支持」
  openExternal: (url: string) => void
  autoLaunch: AutoLaunchApi | null
}
```

判定顺序：`window.electronAPI` 存在 → `electron`；否则 → `web`。控制台只消费 `PlatformCapabilities`，不再出现 `window.electronAPI` 字面量。

「不支持」必须是**正常状态**而不是错误：沿用既有做法（同一套布局 + `—` 占位 / 明确的不可用提示），不切换成简化排版。

### 5.5 运行时配置

现状（已落地）：`packages/contracts/source/runtime-config.ts` 提供 `RuntimeConfig` 与 `createRuntimeConfig`，`runtime-profile.ts` 的两档预设降为默认值来源。

```ts
interface RuntimeConfig {
  environment: 'development' | 'production'
  dataDir: string
  proxyHost: string
  proxyPort: number
  managementHost: string
  managementPort: number
  serveWeb: boolean
  webRoot: string | null
}
```

- 宿主只往 `core` 交一个完整的 `RuntimeConfig`：`startServer({ runtimeConfig, secretStore, systemProxyResolver?, shutdown? })`。`core` 不读环境变量、不猜默认值、不算地址，返回的是 `ServerEndpoints`（实际生效的地址与端口）。
- 宿主负责构造：App 用 `app.setPath('userData', path.join(os.homedir(), runtimeProfile.dataDirectoryName))`（必须在 `app.whenReady()` 之前设，之后 `app.getPath('userData')` 与 `os.homedir()` 才是同一个答案），`shutdown` 传 `null`（它有自己的退出路径）；CLI 用参数 + `defaultDataDirectory()`，并传入一个退出握手对象（见 §6 的 `stop`）。
- **两边都不算数据库文件名**：两个库各自带 schema 版本常量，文件名由 `@common/database-file` 从版本号推导。宿主少算一次文件名，就少一个两种形态可能算出不同结果的地方。
- CLI 参数覆盖：`--data-dir`、`--proxy-port`、`--management-port`、`--host`、`--web` / `--no-web`。端口与数据目录名的缺省值来自 `getRuntimeProfile(CLI_RUNTIME_ENVIRONMENT)`，不另存一份写死的副本。
- `--host` **只作用于代理**，没有对应的 `--management-host`：管理服务不带鉴权，固定监听回环，要远程访问就走 SSH 隧道（`--help` 末尾会直接写明这一点，免得有人翻遍选项去找那个旗标）。所以两个 `*Host` 字段不能合并成一个。
- `--host` 与 `proxyHost` 的关系要注意：`RuntimeConfig.proxyHost` 只是**默认值**，真正生效的监听地址是设置里的 `listenHost`（用户在界面上改过就以设置为准）。因此「命令行传了 `--host` 却没生效」在已有数据目录上是正常行为，而不是配置没被读到。

数据目录的规则只有一条：**`<用户主目录>/<预设数据目录名>`**，两种形态共用这一条，三个平台也是同一条——不再有「先按平台算 appData 目录、再拼目录名」这一步。App 侧是 `app.setPath('userData', path.join(os.homedir(), profile.dataDirectoryName))`；CLI 侧是 `apps/cli/source/host.ts` 里的 `defaultDataDirectory()`（纯函数，`path.dirname()` 的结果就是 `os.homedir()`，能单测）：

| 形态 | 数据目录 |
| --- | --- |
| 正式 | `~/.one-switch` |
| 开发（`pnpm dev`） | `~/.one-switch-development` |

选主目录而不是平台 appData 目录，两个原因。一是 Windows 的 `%APPDATA%` 是**漫游配置目录**：会持续增长的请求日志与正文进去后，在有域控的机器上会被同步到服务器，这是实打实的缺陷。二是「按平台算 appData 目录」恰好就是曾经写错的那处：CLI 在 Linux 上自己写成了小写 `one-switch`，于是同一个用户在两台形态下各拿到半个数据目录：数据库、设置、日志、历史统计全都对不上，而两边都「看起来正常」。改成主目录后平台差异消失，这类分叉从结构上不可能再发生。

三个平台都不新增环境变量：用户改位置只能靠 `--data-dir`。

目录名只允许来自 `getRuntimeProfile(environment).dataDirectoryName`，不许在宿主里写字面量，也不许自己判断平台。CLI 恒定跑 `production` 档（`CLI_RUNTIME_ENVIRONMENT`，`host.ts` 里**唯一**一处选择）：命令行没有「开发服务器」这个输入，所以 `One Switch Development` 只属于 `pnpm dev` 下的桌面形态。

宿主把这三个默认值收在 `apps/cli/source/host.ts`，不散落在命令里：`--help` 里显示的默认数据目录与真正启动时用的是同一个函数，免得帮助里写一套、实际跑另一套。

留一个已知的重复：回环地址 `'127.0.0.1'` 目前在 `runtime-config.ts`（两个 `*Host` 的兜底）、`help.ts`（`--host` 的显示默认值）与 `schemas.ts`（`listenHost` 的 schema 默认值）各有一份字面量。三处现在同值，没有实际危害，但改默认监听地址时必须一起改——这正是 §5.8 反复出现的那类「同一个事实存在多份」，只是它这次落在常量而不是路径上。

### 5.6 i18n 三层

现状：语言目录与核心在 `packages/contracts/source/i18n`，UI 层在 `packages/console/source/i18n`，宿主 native 层在 `apps/app/source/i18n.ts`。

目标：分层不变，归属调整。

| 层 | 归属 | 形态差异 |
| --- | --- | --- |
| 语言目录 + 核心 | `contracts` | 三种形态共用 |
| UI | `console` | 三种形态共用 |
| native | 各宿主自己 | App：托盘、菜单、原生对话框；CLI：终端输出 |

CLI 的 native 层需要一套独立文案（启动横幅、端口占用、数据目录、退出提示），放进 `apps/cli/source/native-i18n.ts`。诊断消息仍按既定契约固定英文（见 [i18n.md](./i18n.md)）。

### 5.7 数据库迁移资源定位

现状（已落地）：`getMigrationsFolder(role)` 从**模块目录**逐级上溯（最多 8 层）寻找 `packages/core/drizzle`，命中即返回 `packages/core/drizzle/<role>`；全链未命中才退到 `process.cwd()/packages/core/drizzle/<role>`，仍落空则返回 `moduleDirectory/packages/core/drizzle/<role>`，让上层报错直接指向一个可解释的期望位置。

**两个库共用这一个上溯过程**是有意的：上溯查找、asar 映射、CLI 的 `files` 只认「`packages/core/drizzle` 这个目录」，拆库只改变了它下面有几个子目录（`config/`、`data/`），没有改变任何一条路径假设。反过来说，给两个角色各写一套上溯逻辑才是真正的风险：两条链会以不同的方式失配，而失配只在运行期才报。

为什么不用固定层数：`drizzle/` 到模块目录的相对深度在两种形态下不同——

| 形态 | 模块目录 | 到 `packages/core/drizzle` 的上溯层数 |
| --- | --- | --- |
| 开发（`pnpm dev`） | `apps/app/dist/command/` | 4 层到仓库根 |
| 打包（asar 内） | `app.asar/dist/command/` | 2 层到 asar 根（electron-builder 把 `packages/core/drizzle` 映射进去） |

固定层数必然在某一侧失效，且失效是运行期才报的。上溯查找对两端同时成立，产物布局再变也不会静默失配。

要求：

- `drizzle/` 必须随包分发（App 的 `files`、CLI 的 `files` 都要包含）。CLI 当前**不发布**、没有 `files` 字段，上溯查找在仓库内从 `apps/cli/dist/` 向上到仓库根命中 `packages/core/drizzle`；一旦开始打包分发，这条就从「恰好成立」变成「必须显式声明」。
- 不依赖 `process.cwd()`：CLI 可以在任意目录启动，cwd 探测只是开发期便利，不是唯一来源；打包后必须靠模块相对路径命中。
- **不要把这一类路径经 `process.env` 传入**：宿主构建会用 Vite，而 Vite 默认把 `process.env` 静态替换为 `{}`，传入的值读出来永远是 `undefined`（详见 §5.8）。

### 5.8 构建与测试编排

现状（已全部落地）：

| 包 | 产物 | 工具 |
| --- | --- | --- |
| `contracts` | 不产出构建物，`exports` 直接指向 `./source/*.ts` | — |
| `core` | 同上 | — |
| `console` | 静态文件 `packages/console/dist` | `vite build`（`packages/console/vite.config.ts`） |
| `app` | `apps/app/dist/command/{index.js,preload.js}`，再交给 electron-builder | 两份 Vite 配置 + `apps/app/scripts/build.mjs` |
| `cli` | ESM `dist/index.js`（`bin` 指向它）+ `dist/web`（拷入的控制台产物） | `vite build`（`apps/cli/vite.config.ts`）+ `apps/cli/scripts/build.mjs` |

编排由 Turborepo 承担（`turbo.json`）：

- `build` 依赖 `^build`，顺序只由依赖图决定：`contracts` → `core` → `console` / `app` / `cli`。实测 `pnpm build` 只跑 3 个任务（只有 console、app 与 cli 真的有构建步骤），「谁先构建」不再需要人工记忆。`cli` 把 `console` 列为 `devDependencies` 纯粹为了让它进依赖图：它构建时需要 `packages/console/dist` 存在（拷入自己的 `dist/web`），而自己不 import 控制台一行代码。
- `typecheck` / `test` 同样依赖 `^build`：上游没通过时，下游的报错不参与排查。
- `lint` 无依赖、可并行，因为它不写产物。
- `dev` 标记为 `cache: false` + `persistent: true`：turbo 并行拉起而不等待依赖，跨进程顺序由宿主自己的编排脚本负责（`apps/app/scripts/dev.mjs`）。
- turbo 要求根 `package.json` 声明 `packageManager`，缺失会直接拒绝运行。

版本号的注入点在拆分后每个宿主一处：`console` 在 `packages/console/vite.config.ts`（`__APP_VERSION__`）、`cli` 在 `apps/cli/vite.config.ts`（`__CLI_VERSION__`），两者都取**仓库根** `package.json` 的版本；`packages/toolkit/vitest.config.ts` 必须把两份 `define` 都同步（历史教训：两处不同步会让任何间接 import 的测试炸掉）。`packages/toolkit/scripts/version.mjs` 是唯一的版本入口，而版本号只写在仓库根的 manifest 里：`pnpm version:set <version>` 从 `pnpm-workspace.yaml` 现算 workspace 包目录、把根版本**强制覆盖**到每一份 manifest（加包不必改脚本），`pnpm version:check` 只读校验它们全都与根一致，挂在 `pnpm lint` 里。之所以要专门盯它，是因为这条链路上有一份**不是代码**的清单——`release.yml` 的 `Commit version` 步骤得把改过的 manifest `git add` 进去，而它曾把 `apps/*` 写死成 `apps/app`：`1.1.0-beta.3` 发出去之后，仓库里的 `apps/cli/package.json` 还停在 `1.1.0-beta.2`。**产物是对的**（CI 里文件确实改了，只是那份改动没被提交），错的是仓库自己，所以 `pnpm typecheck` / `lint` / `test` 一路全绿也看不出来，只有发布之后回头读一遍仓库才会撞见。那条 `git add` 现在与脚本用同一对 glob，`--check` 则负责让「漏提交」在 CI 上直接变红。

测试保持单一 workspace 配置（`packages/toolkit/vitest.config.ts` + `packages/console/scripts/vitest.setup.ts`，经 `packages/toolkit/scripts/test.mjs` 以 Electron 的 Node 执行，以匹配 `node:sqlite` 的 ABI），可按包过滤。两个静态守卫都必须保持通过：`packages/core/scripts/check-proxy-layers.mjs`（指向 `packages/core/source/proxy`）与 `packages/toolkit/scripts/check-package-boundaries.mjs`（已只登记 `packages/*` / `apps/*` 布局）。

宿主侧还有一条只有拆过构建才知道的约束：删掉 `vite-plugin-electron` 之后，Node 与浏览器的构建差异不再有人代为处理。`apps/app/vite.shared.ts` 与 `apps/cli/vite.config.ts` 现在自己负责四件事，而**四者的缺失都只在运行期暴露、且构建全过程无警告**（分别是「入口函数不是函数」、「require 不可用」、「开发态静默按生产端口启动」和「动态导入直接 `ReferenceError`」）：

| 配置 | 缺失时的症状 |
| --- | --- |
| `rolldownOptions.external` 列出全部 `node:` 内置模块（宿主配置再按需加上 `electron`） | `node:fs` / `node:url` 等被换成浏览器空模块，启动即 `(0, v.fileURLToPath) is not a function` |
| `rolldownOptions.platform: 'node'` | 依赖里的 `require('fs')` 不再接上 `createRequire`，运行期报「environment that doesn't expose the require function」 |
| 顶层 `define: { 'process.env': 'globalThis.process.env' }` | Vite 把 `process.env` 整体替换为 `{}`，`process.env.VITE_DEV_SERVER_URL` 恒为 `undefined`，开发态静默按生产端口启动并加载本地 `index.html` |
| `build.modulePreload: false` | Vite 把动态 `import()` 包成 `__vitePreload(() => import(...), deps)`，其辅助函数在 `deps` 非空时读 `document.getElementsByTagName('link')`；Node 里没有 `document`，一旦有带依赖清单的动态导入就直接抛 `ReferenceError: document is not defined` |

`define` 是 Vite 的顶层选项，放进 `build` 里会被静默忽略——写成“配置看着对、行为不对”是这一步最容易踩的坑。

第四条（`modulePreload`）值得单独说明，因为它是**由 CLI 的实际需求反向暴露出来的**：CLI 刻意用动态 `import()`（先探测 `node:sqlite` 再加载 `core`，才能把“Node 太旧”说成人话，见 §6），于是 `start` 一跑就崩，而构建日志里一个字都没有。关掉它并不会把动态导入还原成原生写法——产物里仍然是 `helper(() => import(...), [])`，只是依赖清单为空时辅助函数走 `Promise.resolve()` 短路分支，不再碰 `document`。宿主主进程今天没有任何动态导入，所以这一行在 `app` 侧是**纯防御**：真正要防的是“哪天给主进程加一个动态导入”，而那一刻没有人会想起来回头改构建配置。

S0 平移后复盘出的两类真实脆点，都属于「静态检查看不见、只有跑起来才发现」：

1. **测试内硬编码的目录路径**。`migration-chain.test.ts`（以固定层数 `import.meta.url` 推导 `drizzle/`）与 `i18n/catalogs.test.ts`（硬编码 `render` / `command` / `common` / `server` 子目录名当扫描根）都在平移后失效，typecheck 与 lint 都报不出来。任何以固定层数向上推导资源位置的地方，都应改成显式路径列表或从配置读入。这条经验后来又用上了一次：数据库拆成两个时，`migration-chain.test.ts` 改成 `describe.each(['config', 'data'])` 显式遍历两个角色，而不是把层数推导再写一遍。
2. **HTML 入口里的模块引用**。`packages/console/index.html` 的 `<script type="module" src="/source/main.tsx">` 在文件被移动后仍指向旧路径，`pnpm typecheck`、`pnpm lint`、`pnpm test` 全绿，只有 `pnpm vite build` 会失败（`Failed to resolve /source/main.tsx`）。同理，任何 `index.html` / manifest 里的相对资源路径都应视为迁移清单的一部分，而不是「内容文件」。

CI（`.github/workflows/ci.yml`）与发布（`release.yml`）共用 `.github/actions/setup/action.yml`，两处缓存都由它按 job 开关，因为缓存的适用面本来就不是「全仓库」而是「某个任务到底有没有写这个目录」：

| 缓存 | 路径 | 开关 | 实际在用的 job |
| --- | --- | --- | --- |
| Turbo 任务缓存 | `.turbo` | `turbo-cache`（默认开） | 只有 `Build` 会写：它是唯一跑 `turbo run build` 的 job，其余 job 的 typecheck / lint / test 由包内脚本直跑 |
| ESLint 缓存 / tsc 增量信息 | `node_modules/.cache` | `tool-cache`（默认关） | `Lint`（`eslint . --cache`）与 `Typecheck`（`tsc --incremental`） |

缓存一个命令根本不会创建的目录比不缓存更糟：`actions/cache` 在保存阶段报 `Path Validation Error`，job 白跑一趟，还占着日志让人以为缓存生效了——原先 typecheck / lint / test 三个 job 的 `.turbo` 正是这种情况，现在显式关掉。另一点是收益只出现在第二次运行（首次要写盘，约 15 s），所以 key 不能高频变化，否则等于每次都在付写入成本。本地冷热对照（同机、同一份工作树）：`tsc -p packages/toolkit/tsconfig.check.json` 16.7 s → 6.9 s；`eslint .` 6.1 s → 2.5 s（`pnpm lint` 整体只快一点，守卫脚本与 turbo/pnpm 启动占了大头）。electron-builder 的 Electron 二进制缓存（Windows 的 `%LOCALAPPDATA%\electron\Cache`、macOS 的 `~/Library/Caches/electron*`，每系统约 1.3 GB）**没有**纳入本次改动：Electron 压缩包从 CDN 下载是秒级的，而 Windows 87 s / macOS 91 s 的打包耗时主要在解压与封装本身，为它占掉一个可观份额的 10 GB 缓存配额不划算（未实测，只按量级判断）。

发布说明不再手工维护。原先的 `.github/release-body.md` 已删除，改由 `apps/app/scripts/release-notes.mjs` 从提交记录生成（本地用 `pnpm release:notes` 预览；`release.yml` 的 publish job 不装依赖直接 `node` 跑它，因为它只 import `node:` 内建模块与 `electron-builder.config.cjs`）：

- 变更范围是「上一个发布标签..HEAD」。上一个标签优先取「走得到的标签里离 HEAD 最近的那个」——它表达的是「这一版从哪儿长出来」，历史被重写、补发旧线版本时都对；取不到时退回语义化版本比较，这里**不能**用 git 的 `versionsort`，它默认把 `-rc.1` 这类后缀排在同号正式版**之后**，`v1.0.0` 与 `v1.0.0-rc.8` 并存时会选反。两条都失效时按 `--since=<旧标签时间>` 划范围：旧标签落在已被重写的旧血统上时，`标签..HEAD` 会把两边不相干的三百多个提交也算进来（这不是假设，`v1.0.0-rc.8` 就是这种状态）。
- 分组与破坏性变更都从 Conventional Commit 的 subject / body 里读：`feat` → New，`fix` → Fixed，`perf` → Performance，`refactor` / `polish` / `style` → Changed，其余 → Under the hood；不符合约定的一律进 Other changes，宁可难看也不丢提交。`chore(release):` 不进列表，版本号提交不是变更。
- 下载表由**真实产物文件名**反推：按 `artifactName` 编译出带命名组的正则，平台与架构从匹配结果里取，大小取文件字节数。这样表里出现的文件一定真的在 release 里，不会出现「文档说有、实际没有」；`.zip` / `.blockmap` / `latest*.yml` 不列（内置更新器自己会取），`.sha256` 只在存在时给链接。
- 与之配套，校验文件的生成从「只算 macOS 的 dmg」改成遍历全部 `.dmg` / `.exe` / `.AppImage`：`Create installer checksums` 在三个系统的矩阵 job 内各算各的，所以下载表每一行都能给 SHA-256，不会只剩某一两行有链接、看起来像漏了。
- 范围端点默认 `HEAD`，可用 `--head <标签>` 换掉，补写一个**已经发出去**的版本时必须指到那个标签：否则标签之后合进来的提交会被算进那一版的说明（把没发布的活记在旧版本头上），并且这些提交会从下一版的说明里消失，让下一版看起来「什么都没改」。补写时同样没有本地产物目录，用 `--assets-json` 吃 `gh api repos/<owner>/<repo>/releases/tags/<标签> --jq '[.assets[] | {name, size}]'` 的清单：安装包几百 MB，只为拿文件名和大小再下一遍不值当。清单在 Windows 上按这个重定向写法存盘会带 UTF-8 BOM，脚本先剥掉再 parse，否则一个看不见的字节就会让 `JSON.parse` 把整份清单判为非法。`--assets-dir` / `--assets-json` 缺目录、缺文件都直接报错拦住发布，不静默省略下载表——发出去的说明少一块，比发不出去更糟。修改已发布版本的正文用 `gh release edit <标签> --notes-file <文件>`；说明文字仍然只在 GitHub 上改，不进仓库。
- `softprops/action-gh-release` 不再开 `generate_release_notes`：它自己附带的那行 Full Changelog 与脚本写的重复，两行怎么合并由 action 决定，不如自己只留一行。

## 6. CLI 契约

命令名 `one-switch`，无子命令时等价于 `start`。

| 命令 | 说明 |
| --- | --- |
| `one-switch start` | 启动代理与管理服务；`--web` 时同时托管控制台 |
| `one-switch stop` | 停止由本 CLI 启动的实例（通过数据目录下的运行时文件定位） |
| `one-switch status` | 输出运行状态、监听地址、数据目录、版本；只读，不清理失效的运行时文件；`--json` 输出同一份数据的机器可读形态 |
| `one-switch version` | 输出版本号（与 `--version` 同源） |
| `one-switch config` | 读取或写入设置（与设置页同一份数据）——**未实现**，本轮不做 |

参数解析在 `apps/cli/source/options.ts`（纯函数，不碰进程与文件系统，便于单测）：无子命令时默认 `start`，`--opt=value` 与 `--opt value` 两种写法都接受，出现第二个位置参数即报错而不是默默丢掉。`--help` / `--version` 是全局开关，即使与子命令同时出现也优先输出后退出。`--json` 只对 `status` 有意义，出现在别的命令上直接按用法错误退出（退出码 `2`），而不是静默忽略——「参数被吞掉」比「参数被拒绝」难查得多。

行为约定：

- 前台运行，`Ctrl+C` 触发优雅退出（等价 `stopServer()`）；`--daemon` 不在首期范围内。`stop` 也走同一条关闭链路：向管理服务发一个带 `shutdownToken` 的 `/api/runtime/shutdown`，然后**以「进程真的消失」为完成依据**，而不是相信 HTTP 响应——服务答应之后还可能死在关闭中途。
- 端口被占用时给出明确错误并以非零码退出，不静默换端口。
- 启动后打印访问地址、代理地址与数据目录，方便用户直接复制。`--no-web` 时打印同样的块，把「控制台」那一行换成「管理服务」地址、并补一行说明控制台托管已关闭——布局不因开关而变。
- CLI 依赖 `node:sqlite`，启动时做能力探测；不可用时给出明确的 Node 版本升级提示后退出，不做降级。这条能力探测必须是动态 `import()`：静态引入 `core` 会让旧 Node 在解析阶段就报「不认识的模块」，用户看到的会是一段与 CLI 无关的堆栈，而不是那句升级提示。
- 退出码语义固定为：`0` 成功（包括「本来就没在跑」）、`1` 运行期失败、`2` 用法错误。脚本据此能区分「命令写错了」与「跑起来但出错了」。
- **同一数据目录只有一个实例**。互斥是 core 的**基本能力**（`packages/core/source/runtime/instance-lock.ts`）：`startServer` 在绑定端口**之前**取锁，拿不到就抛 `InstanceLockError`，CLI 在 `start` 里把它翻译成人话并以退出码 `1` 退出，而不是覆盖 `runtime.json`——覆盖会让先启动的进程**失去身份**：`stop` 再也找不到它，它却还占着端口、开着同一个 SQLite 文件。
  - 端口冲突只能挡住「沿用默认端口」的那一半情况，`--proxy-port` 一换就绕过去了；`runtime.json` 也挡不住，因为它是**监听成功之后**才写的，两个进程在写它之前有一段谁都看不见的空窗。
  - 锁文件是数据目录下的 `instance.lock`，内容是一份 `{pid, startedAt, heartbeatAt}` 的声明；由 `startInstanceLockHeartbeat` 每 5 s 续写心跳。判定持有者是否还活着要**同时**看 pid 还在不在与心跳新不新鲜（心跳超过 6 个周期即视为旧），只判 pid 会把被操作系统复用的 pid 当成活实例。
  - 锁不长期持有文件句柄：Windows 上 `fs` 的默认共享模式允许别的进程删掉它，持有句柄并不构成强制锁。所以残留靠上面的存活判定识别，而且清算**只发生在取锁那一刻**——`acquireInstanceLock` 读到持有者已死（或读不出持有者、又过了宽限期）就地清掉重试。宿主不参与：`stop` 不碰锁文件，`start` 也不预清，谁都不会在别人正拿着锁时把它删掉。
  - 读到「锁文件存在但内容读不出」时不能立刻当残留删掉：创建与写入之间必然有一瞬是空文件，把这一瞬当成残留会让两个进程同时认为自己拿到了锁。按 mtime 给 5 s 宽限，超过它才是上次崩溃留下的半截文件。
- **崩溃也要留下干净的现场**。`uncaughtException` / `unhandledRejection` 统一走一次清理（删掉自己写的 `runtime.json`、打印一条 `[cli]` 前缀的说明）后以退出码 `1` 结束，并挂一个 5 s 的兜底定时器防止清理本身卡死；实例锁不归这里管——它由上面那套持有者判定接手，所以清理函数只删自己的文件，不会误伤别人的现场。少了这一段，崩溃一次就会留下「`status` 说在跑、`stop` 停不掉、`start` 又起不来」的三重假象。
- **`status --json` 与文本输出同源**。两者都由同一份 `InstanceReport` 渲染（`status-report.ts`），字段顺序固定为 `state` / `cliVersion` / `instanceVersion` / `dataDir` / `pid` / `startedAt` / `management` / `proxy` / `consoleUrl` / `staleRuntimeFile` / `portListening`，未知值一律 `null`，不出现给人看的占位符 `—`（脚本拿到 `"—"` 会当成字符串值用下去）。端点写成 `{host, port, url}`：`url` 是**连得过去**的地址，与 `host` 可能不同——`0.0.0.0` 是监听地址，不是可连接地址。
- **非回环监听时说清楚代价**。启动时若监听地址不是本机回环，往 stderr 打两行告警（代理端口不带鉴权，局域网内任何人可读写）；走 stderr 是为了不让它混进 `--json` 的 stdout，而且告警只提**代理**端口——管理接口本来就有实例 Token，不该拿一句模糊的「无鉴权」吓人。
- 诊断信息（失效的运行时文件、端口未被监听、CLI 与实例版本不一致）一律走 stderr 且保持英文：它们面向的是日志与排查，不是终端里的用户，`--json` 的 stdout 必须可以原样喂给解析器。
- 冒烟验证由 `pnpm smoke:cli` 承担（`apps/cli/scripts/smoke.mjs`，9 步、对**构建产物**起真实子进程）：启动并校验横幅不泄露通配地址、管理 API 与 `GET /`、`status --json` 的运行中形态与文本 9 行布局、第二个实例被拒且第一个存活、`stop` 后端口释放与文件清理、伪造的死 pid 运行时文件被识别为「未运行」、`--no-web` 下 `GET /` 为 `404` 而 API 照常、以及各用法错误的退出码。静态检查全绿不等于 CLI 可用——它写文件、占端口、起子进程，这些只有真跑才会暴露。

### 与桌面形态的一致性

契约只有一句：**两种形态驱动的是同一套服务、同一份数据，差别只在「怎么把它起来」。** 凡是用户能看见的东西——数据库、设置、供应商与模型、重写规则、请求日志与保留策略、监听地址与端口的取值来源、`Ctrl+C` 走的优雅退出链路——都必须一致；允许不同的只有**宿主能力**本身。

| 维度 | 状态 | 说明 |
| --- | --- | --- |
| 数据目录 | 一致 | `<用户主目录>/<预设数据目录名>`，见 §5.5 |
| 数据文件名 | 一致 | 两边都由 `@common/database-file` 从**库自己的 schema 版本常量**推导（`one-switch-config-v1.db` / `one-switch-data-v1.db`）。宿主不算文件名，所以「两边算出不同文件名」这类差异从结构上不存在 |
| `RuntimeConfig` | 一致 | 同一份 `createRuntimeConfig`；命令行只多传端口与数据目录的覆盖值 |
| 代理引擎与业务 | 一致 | 同一份 `packages/core`，命令行不写业务逻辑（包边界守卫强制） |
| 设置与日志 | 一致 | 同一对 SQLite 文件（配置库 + 数据库），没有第二份配置 |
| 单实例 | 一致（同一个 core 能力） | 两边都由 core 的 `runtime/instance-lock.ts` 在绑定端口前取锁；区别只在于桌面形态还多一层操作系统级的 `app.requestSingleInstanceLock()`，第二次启动会唤醒已有窗口而不是报错 |
| 密钥存储 | 能力差异 | 桌面形态有系统钥匙串（`safeStorage`），命令行只能文件加密，文件名因此分开（§5.1） |
| 系统代理解析 | 能力差异 | 桌面形态用 `session.resolveProxy`（OS/Chromium）；命令行暂时不注入解析器，`system` 模式等价直连（见下） |
| 控制台托管 | 形态差异 | 桌面形态用窗口 `loadFile`；命令行没有窗口，只能由管理服务托管（`--web`，默认开） |
| 托盘 / 自动启动 / 更新器 / 原生对话框 | 形态差异 | 桌面上才有这些入口，命令行没有等价物 |

两处「能力差异」值得单独说明：

- **系统代理**：`system` 是默认的出站模式（见 [outbound-proxy.md](./outbound-proxy.md)），而命令行没有原生 API 能读操作系统的代理配置。当前不注入解析器，core 的默认返回值是 `DIRECT`，所以命令行下「跟随系统代理」等价于直连。这个结论是**看得见**的：`POST /api/diagnostics/outbound-proxy-test` 会返回 `system-direct`，不是静默失效。刻意不拿 `HTTP_PROXY` 之类的环境变量凑一个「像系统代理」的解析器——那会给命令行**新增**一种桌面形态没有的差异（Chromium 的 `session.resolveProxy` 不读环境变量），与本节要达成的目标相反。命令行下要用代理就选 `custom`。
- **`status` / `stop` 只认命令行启动的实例**：它们靠数据目录下的 `runtime.json` 定位实例，而桌面形态不写这个文件。桌面形态不写，是因为它的服务与窗口在同一个进程里，`stop` 停掉服务等于把用户的窗口弄成半死；写一个「能被发现却拒绝被停」的文件，只会把 `stop` 引向一次 10 秒超时。所以命令行启动的实例归命令行管，桌面形态的实例归它自己的窗口与托盘管。两者仍然共用同一个数据目录与同一对数据库文件，只是「谁在跑」这件事各有各的真相来源。

## 7. 迁移阶段

每一阶段都必须以「现有验证全绿」为前置：`pnpm typecheck`、`pnpm lint`、`pnpm test`。

### S0 骨架平移（不改逻辑）— 已完成

范围：建立 pnpm workspace 与包骨架，按 §4.2 平移目录与导入别名，**不动任何业务逻辑**。

产出：`pnpm-workspace.yaml` 增加 `packages/*` 与 `apps/*`；`packages/{contracts,core,console}` 与 `apps/app` 各自的 `package.json` / `tsconfig.json`；根目录只留工作区级配置，`drizzle.config.ts` 进 `packages/core/`、`components.json` 进 `packages/console/`、图标进 `apps/app/build/`、打包配置与打包脚本进 `apps/app/`；守卫脚本进 `packages/toolkit/scripts/` 与 `packages/core/scripts/`；根 `package.json` 的 scripts 全部改为调各包 `scripts/` 与 turbo。

验收结果：`pnpm typecheck` ✓、`pnpm lint` ✓（分层 48 文件 + 包边界 249 文件）、`pnpm test` ✓（109 文件 / 1123 测试，与平移前一致）、`pnpm build` ✓（turbo 2 个任务，console 静态产物 + 主进程/preload 两份产物齐全）。`pnpm build` 的 electron-builder 环节用 `--dir` 模式验证过：`app.asar` 内同时含 `dist/render/index.html` 与 `packages/core/drizzle/**/migration.sql`，符合 §5.7 的路径假设。

`pnpm dev` 已端到端复验：控制台 dev server 起来后才拉起 Electron，首轮构建落定后才开始监听产物，启动横幅显示 `Environment : development` 与 19300 / 19301 端口，数据库初始化、两个监听器与托盘初始化全部完成，且主进程改动恰好触发一次重启。

平移期间发现并修复：`packages/console/index.html` 的入口脚本仍写着 `/source/main.tsx`（详见 §5.8 末段）。这类问题三个静态检查全绿也发现不了，必须跑一次真实构建。同类问题还有一个：Electron 留在仓库根，开发与静态检查全部照常，但 electron-builder 在打包时探测不到版本，直到第一次真实发布三个平台同时失败才暴露（详见 §4.3 坑 4）。

环境限制（与平移无关）：Windows 上以非管理员身份跑完整 `pnpm build`，electron-builder 解压 `winCodeSign` 缓存时需要创建符号链接的权限而失败（`Cannot create symbolic link ... libssl.dylib`）。需要开启「开发者模式」或以管理员身份执行；临时绕过可加 `-c.win.signAndEditExecutable=false`，代价是 exe 不嵌入图标。

剩余：`apps/cli` 尚未建立，留待 S2。

### S1 core 可独立运行 —— 本轮跳过

范围：`core` 与 `contracts` 产出独立构建产物；新增 `packages/toolkit/scripts/smoke-core.mjs` 用裸 Node 启动服务并发起一次代理请求。

验收：不安装 Electron 的 Node 进程能启动 core、能完成一次成功转发与一次失败切换，且能用 `Ctrl+C` 干净退出。

跳过理由：CLI 选择在构建期用 Vite 别名把 `core` / `contracts` 的**源码**直接打包进去，不去消费它们的独立产物，因此没有驱动这一阶段的需求。代价要说清楚：`apps/cli/vite.config.ts` 因此必须自带一份完整的 `rolldownOptions`（外部化、`platform`、`define`，见 §5.8），不能复用 `vite.shared.ts`（那份包含了 `electron`）。留到真有第三方单独消费 `core` 时再做。

实际上被 S1 替代的验收（裸 Node 能跑起服务）已由 S2 的端到端验证覆盖。

### S2 CLI 成型 —— 已完成（发布形态除外）

范围：落地 §5.1、§5.2、§5.3、§5.4、§5.5；实现 `start` / `stop` / `status` / `version`。`config` 与 `--daemon` 不在本轮。

产出：`apps/cli`（`@one-switch/cli`，`private: true`，`bin.one-switch` → `dist/index.js`）。实现拆为「宿主适配」（`host.ts` / `native-i18n.ts` / `runtime-state.ts` / `secret-store.ts` / `management-client.ts`）+「命令」两层，参数解析单列 `options.ts` 为纯函数，`index.ts` 只负责分发与退出码。包边界守卫新增 `RULES.cli`：禁止依赖 `console` 与 `app`、禁止 `electron`（`packages/*` / `apps/*` 布局下的 `PACKAGE_ROOTS.cli = ['apps/cli/source']` 已在 S2 自动生效）。

验收（实测，控制台−管理 API 全链路）：

| 项 | 结果 |
| --- | --- |
| `one-switch --version` / `version` | `1.1.0-beta.2`（与仓库根 manifest 一致，注入点见 §5.8） |
| `one-switch --help` | 完整中文横幅，默认值取自平台数据目录与 production 预设 |
| `status`（数据目录为空） | 9 行固定布局，运行期字段全为 `—`，退出码 `0` |
| `status`（运行中） | 「运行中」+ 真实 PID/启动时间 + 代理地址**取自管理服务的实际值**而不是运行时文件 |
| `start` | 两个监听器就绪，打印控制台/代理/数据目录三行 |
| `GET /`（托管中） | `200` `text/html` `no-cache`；哈希资产 `200` `public, max-age=31536000, immutable` |
| 控制台所调的管理 API | `/api/provider/list`、`/api/logical-model/list`、`/api/settings/get`、`/api/logs/list`、`/api/request-rewrite-rule/list`、`/api/router/graph`、`/api/proxy/status` 全部 `200`（均为 POST） |
| 代理链路 | `POST /v1/chat/completions` 正确识别协议并给出 `NO_AVAILABLE_PROVIDER`（空库下的预期结果，路径本身跑通） |
| `stop` | 「正在请求 pid … 退出」→「已停止」，退出码 `0`，两个端口随后不再处于监听 |
| `status`（stop 后） | 回到「未运行」+ 全 `—`，运行时文件已删除 |
| 失效运行时文件 | `status` 只在 stderr 提示一行、不删文件也不显示死进程的端口/PID；`stop` 清理文件并退出码 `0` |
| `--no-web` | `GET /` → `404`，API 照常 `200`，横幅多一行说明 |
| 静态检查 | `pnpm typecheck` / `pnpm lint` / `pnpm test`（113 文件 / 1170 测试）/ `pnpm build` 全绿 |

本轮发现并修复的真实缺陷：**宿主构建必须 `modulePreload: false`**（见 §5.8 第四条）。`start` 一跑即崩（`ReferenceError: document is not defined`），而 `typecheck` / `lint` / `test` / `build` 四个环节全绿——这属于 §5.8 末段归纳的那类「只有真实运行才发现」的脆点，而且比 S0 那两类更隐蔽：产物里确实带着浏览器代码，报错点（`document`）离原因（构建配置）隔着整个打包层。

未做：`config` 子命令、`--daemon`、以及 S4 的全部内容（包括 CLI 打包后的 `files` 声明，见 §5.7）。

### S2.1 CLI 生产级细节补齐 —— 已完成

范围：S2 把 CLI 跑通了，但「跑得通」与「敢让人天天用」之间还差四件事——多实例互斥、机器可读的状态、真实运行期的冒烟验证，以及把危险配置说出来。四件都在 CLI 侧，都不触碰 core 与协议层。

| 项 | 内容 |
| --- | --- |
| 单实例互斥 | 新增 `instance-lock.ts`，`start` 先取锁；第二个实例被拒（退出码 `1`）而不是覆盖 `runtime.json`（残留锁当时由 `stop` 顺手清理，S2.4 已删掉那一手，见下） |
| 崩溃兜底 | `uncaughtException` / `unhandledRejection` → 清理 `runtime.json` → 退出码 `1`，另有 5 s 强制兜底 |
| 机器可读状态 | `status --json`；文本与 JSON 同源于 `status-report.ts` 的 `InstanceReport`，从而不可能互相矛盾 |
| 诊断 | 端口未被监听、CLI 与实例版本漂移、失效运行时文件，一律英文走 stderr |
| 安全告警 | 非回环监听时提示管理 API 无鉴权、局域网内可读写 |
| 自动化冒烟 | `apps/cli/scripts/smoke.mjs`（`pnpm smoke:cli`），9 步对构建产物起真实子进程 |

验收（实测）：`pnpm smoke:cli` ✓ 9/9；`pnpm test` ✓（116 文件 / 1197 测试，新增 `host.test.ts` / `instance-lock.test.ts` / `status-report.test.ts`）；`pnpm typecheck` / `pnpm lint` ✓（包边界 269 文件）。

这一轮最有价值的一条是**冒烟脚本一写出来就抓到了真缺陷**：伪造一个死 pid 的运行时文件后，`status --json` 把死进程的 `pid` 与端口照样输出了出去，而同一个对象的 `state` 是 `stopped`——字段之间自相矛盾。原因是报告对象先被运行时文件预填、判定为残留的那条分支只加了 `staleRuntimeFile: true` 而没把已填进去的字段清空。这类「对象构造顺序」缺陷正是 `status` 的单元测试最容易漏掉的地方：单测里我先写好期望值再调渲染函数，而真实的输入来自磁盘上一份半真半假的文件。修复方式是残留分支显式把 `instanceVersion` / `pid` / `startedAt` / `management` / `proxy` / `consoleUrl` 归零。

### S2.2 两种形态的一致性 —— 已完成

范围：把「命令行与桌面形态只是驱动方式不同，其余行为必须一致」这条要求逐项核过一遍。审计结论与三类清单见 §6「与桌面形态的一致性」；本轮只改真正违反它的两处，其余以能力/形态差异的形式写进文档，不留静默分叉。

| 项 | 内容 |
| --- | --- |
| 数据目录 | 目录名改为唯一取自 `getRuntimeProfile(CLI_RUNTIME_ENVIRONMENT).dataDirectoryName`（当时仍拼在平台 appData 目录下，后由 S2.3 改为用户主目录）。修掉 Linux 上 `$XDG_CONFIG_HOME/one-switch`（小写）与桌面形态 `~/.config/One Switch` 的分叉 |
| 预设选择 | `CLI_RUNTIME_ENVIRONMENT` 成为 CLI 唯一一处「跑哪一档」的选择，`start.ts` 与 `help.ts` 不再各写一遍 `'production'` |
| 密钥文件名 | 命令行改用 `secrets.cli.json` / `secrets.cli.key`：与桌面形态的 `secrets.json` 同名会让后写的那个把前一份的密钥全部作废（两种密文算法互不相识），而供应商 key 作废了不可再生 |
| 文档 | `runtime-profile.ts` 的 `dataDirectoryName` 与 `runtime-config.ts` 的宿主指向注释；`§5.1` / `§5.5` / 新的 §6 小节 |

验收（实测）：`pnpm test` ✓（116 文件 / 1204 测试，本轮新增 7 个用例）；`pnpm typecheck` / `pnpm lint` ✓；`pnpm build` ✓；`pnpm smoke:cli` ✓ 9/9。

两处「看代码看不出来」的地方值得记下来。一是 `defaultDataDirectory()` 里那个小写常量，注释写的是「Linux 按 XDG 惯例用小写」——**它读起来像一条刻意的决定**，而实际上它与桌面形态的 `app.getPath('appData') + profile.dataDirectoryName` 是两条独立实现，只有 Windows 与 macOS 恰好撞对。二是两个 `secret-store` 实现写同名文件这件事，旧文档明确写了「共用数据目录时两张表各自存在，互不覆盖」——一条**写错的断言比没有文档更危险**，它会让后来的人跳过核对。两处都不是静态检查能发现的：前者只在 Linux 上显形，后者只在两个形态真的去读同一份数据时才炸。

### S2.3 数据落在用户主目录 + 配置与观测拆成两个库 —— 已完成

范围：数据目录从 `<平台 appData 目录>/<预设数据目录名>` 改成 `<用户主目录>/<预设数据目录名>`；单个 `one-switch-v<应用主版本>.db` 拆成 `one-switch-config-<n>.db` 与 `one-switch-data-<n>.db`。**不考虑兼容、不考虑历史**：换代只换文件名，不做迁移，也不做任何版本检测。

| 项 | 内容 |
| --- | --- |
| 数据目录 | `~/.one-switch`（开发档 `~/.one-switch-development`）。App 侧一行 `app.setPath('userData', path.join(os.homedir(), profile.dataDirectoryName))`；CLI 侧 `defaultDataDirectory()`。选主目录的两个理由见 §5.5 |
| 库拆分 | 配置 12 张表 / 观测 10 张表，两个文件、两条 Drizzle 链（`drizzle/config`、`drizzle/data`）、两份 schema（`config-schema.ts` / `data-schema.ts`）。拆分理由见 [data-model.md](./data-model.md) §2.1 |
| 跨库外键 | 全部移除（SQLite 外键不可能跨文件）。`provider_health` / `provider_model_health` 改为惰性创建（第一次成功或失败才插行），创建/删除配置实体不再碰观测库；启动时 `pruneOrphanHealthRows` 清理孤儿行 |
| 文件名 | 从「应用主版本号」改为「**该库自己的 schema 版本号**」（`DATABASE_SCHEMA_VERSIONS`）：补丁版本不该让用户的配置换个文件住 |
| 静态守卫 | 新增 `packages/core/scripts/check-database-boundaries.mjs`，并入 `pnpm lint`：每个 store 只碰自己那个库、两份 schema 不互相引用、表不重复出现在两个库里 |
| 文档 | [data-model.md](./data-model.md) §2 / §2.1 / §2.2 / §3.8 / §6 / §7；本文件 §5.5 / §5.7 / §6；`tech-architecture.md`、`observability.md`、`server-architecture.md` 与两份 README |

验收（实测）：`pnpm typecheck` / `pnpm lint` / `pnpm test`（116 文件 / 1210 测试）/ `pnpm build` / `pnpm smoke:cli` 全绿；无参启动一次真实 CLI 产物，`~/.one-switch` 下确实同时出现 `one-switch-config-v1.db` 与 `one-switch-data-v1.db`（且不再产生任何单个 `one-switch-v<n>.db`），`stop` 后同两个文件依旧 ✓。收尾时删掉了兼容/历史相关的 2 个用例（「拒绝不受支持的库」），故从 1212 降到 1210。

两处「看代码看不出来」的地方值得记下来。一是 `defaultDataDirectory()` 里那个小写常量，注释写的是「Linux 按 XDG 惯例用小写」——**它读起来像一条刻意的决定**，而实际上它与桌面形态的 `app.getPath('appData') + profile.userDataDirectoryName` 是两条独立实现，只有 Windows 与 macOS 恰好撞对。二是两个 `secret-store` 实现写同名文件这件事，旧文档明确写了「共用数据目录时两张表各自存在，互不覆盖」——一条**写错的断言比没有文档更危险**，它会让后来的人跳过核对。两处都不是静态检查能发现的：前者只在 Linux 上显形，后者只在两个形态真的去读同一份数据时才炸。

### S2.4 宿主与实例身份收口 —— 已完成

范围：一次横向收口。触发点是「审计里那些**看起来像刻意设计**的东西」——实例互斥只写在 CLI 里、管理接口的 token 只在关停那一条路径上校验、跨域头恰好没开放 token 头。三条都不是空的，但都只在某一个宿主的某一条路径上成立，换个宿主或换条路径就漏。这一轮把它们变成 core 的默认行为，并顺手修掉代理与前端在同一轮审计里暴露的问题。

| 项 | 内容 |
| --- | --- |
| 实例互斥上收 | `instance-lock.ts` 从 `apps/cli` 移到 `packages/core/source/runtime/`，改由 `startServer` 在绑定端口前取锁（§6「同一数据目录只有一个实例」）。CLI 与桌面形态共用同一个实现，测例随之移到 core；宿主与锁彻底解耦——`stop` 曾经顺手清的残留锁已删除（接管只发生在取锁那一刻，`clearStaleInstanceLock` 随之消失），`start` 只认留下的 `InstanceLockError` 并把它翻成本地文案 |
| 新增存活语义 | 锁声明加 `heartbeatAt`，由 `startInstanceLockHeartbeat` 每 5 s 续写；持有者判定改为「pid 活着**且**心跳新鲜」，修掉 pid 被复用后把死实例当活实例 |
| 实例身份 | 新增 `runtime/runtime-identity.ts`：每次启动生成 32 字节随机 Token（只在内存里），`/api/*` 一律要求 `x-one-switch-token` 且常量时间比对（见 [security-privacy.md](./security-privacy.md) 的「访问控制」） |
| 统一守卫 | `management/core/request-guards.ts` 统一处理鉴权与跨域；CORS 只回显已识别的本地来源，且允许头里不含 token 头 |
| 页面注入 | 桌面形态由 preload 把 `{apiBase, token}` 注入 `window.__ONE_SWITCH__`；命令行形态由 core 托管 `index.html` 时注入，静态资源一律 `no-store` + `nosniff` |
| 请求体上限 | **不设限**：管理接口（`management/core/request-body.ts`）与代理入口（`proxy/request/request-entry.ts`）都完整读取正文。两道闸门都拆了——管理接口的守卫在解析正文前就验凭证，代理是本地工具、不做资源消耗攻击假设（见 [security-privacy.md](./security-privacy.md)） |
| 宿主收尾 | 桌面形态补上 `app.requestSingleInstanceLock()`、异步 `before-quit`（5 s 兜底）、隐藏启动与不再致命的 `unhandledRejection` |
| 代理归因 | 失败归类拆出「供应商级 / 模型级 / 不记」三档；流被中途截断、以及**响应形态与请求协议不符**（双向判定）都归到模型级，耗尽时把最后一次上游响应摘要写进错误 |
| 代理稳健性 | 观察者逐个 try/catch（一个观察者抛异常不再带走整次转发）；下游背压时等 `drain` 再算写完；剥离 `accept-encoding`（链路上没有任何解压，协商压缩只会让正文读不了）；自定义鉴权头保留协议固定头 |
| 请求头透传 | `createUpstreamRequestHeaders` 改成**默认转发**：客户端带了什么就转发什么（连名字的大小写都不动），只排除四类有理由的头——与位置绑定的 `host`/`content-length`、逐跳头与 `connection` 点名的头、客户端鉴权头、`accept-encoding`。协议固定头拆成 `replace` / `fill` 两半（`resolveProtocolAuthHeaders`），`anthropic-version` 这类只在客户端没带时补上，不再盖掉客户端的值（见 [proxy-engine.md](./proxy-engine.md) §5「已钉在测试上的不变式」） |
| 控制台 | 拆开撞车的 `['provider-models']` 查询键、补上拖拽监听器卸载清理、重写规则页的加载失败与开关回滚、出站代理探测加客户端超时、`?? []`/`?? {}` 换成稳定空值、切换筛选时收起展开行 |
| 发布版本清单 | 版本号收敛成单一来源：`version.mjs` 从 `pnpm-workspace.yaml` 现算包目录、把根 manifest 的版本强制覆盖到每一份 manifest，新增 `--check` 并挂进 `pnpm lint`；`release.yml` 的 `git add` 改成与脚本同一对 glob（见 §5.8） |
| 共享配置归属 | 顺着「根目录还剩什么」的复核，`vitest.config.ts` 与 `tsconfig.check.json` 从仓库根搬进 `packages/toolkit`：它们各自的唯一消费方是该包的 `scripts/test.mjs` 与 `scripts/typecheck.mjs`，而 `vitest` 接受 `--config`、`tsc` 接受 `-p`；根目录只留工具约定必须在那里找到的文件（见 §4.3） |
| 残留清理 | `tsconfig.check.json` 的 `include` 里还写着 `packages/core/drizzle.config.ts`，而该文件早已被拆成 `drizzle.config.config.ts` / `drizzle.config.data.ts`——`tsc` 对指向空气的条目**静默成功**，于是两份 drizzle 配置从未进过任何一次类型检查。`scripts/typecheck.mjs` 现在会先校验每条 `include` 都能落到实文件；`turbo.json` 里那三个无人实现的 `typecheck` / `lint` / `test` 任务一并删除 |

验收（实测）：`pnpm typecheck` / `pnpm lint`（代理层 48 文件、数据库边界 146 文件、包边界 270 文件）/ `pnpm test`（116 文件 / 1235 测试）/ `pnpm build:cli` / `pnpm smoke:cli`（9/9）全绿。收尾时删掉了 4 条用例（管理接口的两条限长、`clearStaleInstanceLock` 的两条），另补 1 条「声明 64 MiB 也照样解析」把「不设限」钉住，故从 1234 降到 1231；随后做请求头透传收口时又补 5 条（`response/headers.test.ts` 的「未知自定义头原样转发」与「协议固定头只补缺」、`protocols.test.ts` 的 3 条 `replace`/`fill` 拆分），删掉 1 条（`requestHttpBuffered` 的响应体上限），故为 1235。`1.1.0-beta.3` 发布之后复核仓库时又发现 `apps/cli/package.json` 根本没进过版本提交（成因与修法见 §5.8），一并补上；这条修法不新增用例，测试数不变，仍是 116 文件 / 1235 测试。搬走两份共享配置之后复核过等价性：`tsc --listFiles` 的文件集在搬家前后**逐条相同**，搬迁本身不改变任何被检查的文件；唯一实质变化是那两份 drizzle 配置从此被覆盖，类型检查程序从 584 个文件变成 586 个。

冒烟脚本在这一轮之前已经**悄悄失效**，而它那几天没跑：`/api/*` 加实例 Token 校验之后，脚本没带头，卡在第 2 步的 `403` 上。它停在那里，就没人发现 `status` 用的是同一个姿势探活——`status --json` 从此只可能报 `unresponsive`，因为它的探活请求也不带 Token，`403` 被读成「进程在、服务不答应」。两处都在这一轮修掉：脚本从运行时文件带上 Token，并新增两条断言（错 Token 必须 `403`、崩溃残留的 `instance.lock` 会被下一次 `start` 接管）；`status` 从运行时文件带上 Token。教训是：**一个停住的冒烟脚本比没有更危险**，它会让后续每一轮都默认「那一层已经验过了」。

这一轮的教训只有一条，但值得单独写下来：**「读起来像刻意决定」的代码最难发现**。上面三处都是同一种形状——真正的约束写在调用方而不是被调用方，于是补第二个调用方（第二个宿主、第二条关停路径、第二个页面）时就悄悄失效了。判断标准因此不是「这行代码有没有注释」，而是「这个保证写在谁的边界上」。

### S3 App 回归

范围：`app` 与其内联的渲染层构建彻底解耦（`electron-builder` 配置与打包脚本已在 S0 迁入包内，只剩构建产物映射与目录细分）；`apps/app/source` 按 §4.1 目标态拆出 `main/` 与 `preload/`；托盘、自动更新、开机自启、原生对话框保持。

验收：桌面安装包端到端可用；升级路径（检查更新 → 下载 → 安装）不回归。

### S4 分发与文档

范围：CLI 发布形态（npm 全局 bin）+ `engines` 声明 + README 使用说明；`product/` 相关文档同步（`tech-architecture.md` 的项目结构与构建章节、`server-architecture.md` 的目录树、`roadmap.md` 的进度条目）。

验收：`npx one-switch` 在干净机器上可启动；文档与仓库结构一致。

**当前明确不做**：CLI 暂不发布，因此本阶段的发布形态（npm 全局 bin、`engines`、`npx` 验收）全部未启动；`apps/cli/package.json` 里 `bin` 已就位但 `private: true` 未摘。文档同步部分已在 S2 一并完成（`packaging.md` 本节与 `roadmap.md` 的工程演进节）。开始本阶段前需要先办的事：定 `files`（至少含 `dist/` 与 `packages/core/drizzle`，见 §5.7）、确定启动时如何定位 `node:sqlite` 不足的提示文案，以及确认 `bin` 入口的 shebang 与执行位在三个平台上都成立。

## 8. 明确不做

- 不引入 HTTP 框架（沿用原生 `http`，见 [tech-architecture.md](./tech-architecture.md)）。
- 不引入原生依赖（密钥走文件加密，不走系统钥匙串；`node:sqlite` 已满足持久化）。
- 不做远程多用户、鉴权体系与 Docker 化镜像；CLI 仍是本机单用户形态。
- 不做 Electron 之外的第二种桌面壳，也不为 CLI 单独维护一套 UI。

## 9. 决策记录

| 决策 | 选择 | 备选与理由 |
| --- | --- | --- |
| 包结构 | pnpm workspace 多包 | 单包多入口无法用编译期/lint 强制边界，也没法让 core 被第三方单独消费 |
| 包命名 | `@one-switch/*` | 需要 npm org；备选 `@yinxulai/*`（个人 scope，无需建 org） |
| CLI 分发 | npm 全局 bin / `npx` | 单文件可执行（Node SEA）作为后续增量，首期不阻塞 |
| CLI 密钥 | 本地文件 AES-256-GCM | 系统钥匙串需原生依赖，与零原生依赖约束冲突 |
| 推进顺序 | 先 S0 平移 | 现有代码已事实上分层，平移零行为风险，却能立刻把边界变成约束 |
| 目录分层 | `packages/` 放库、`apps/` 放宿主壳 | 曾把 cli / app 也放进 `packages/`；但「可被第三方消费」与「可直接执行」是两件事，宿主壳不该被当作库发布 |
| S0 导入写法 | 别名重指向，不改 specifier | 直接换成 `@one-switch/*` 是一次上千处的高风险改动，无法分批验证（见 §4.2） |
| `build/` 与打包配置 | 收进 `apps/app/`（已在 S0 内完成） | 一开始顾虑三重耦合而暂留仓库根，实际按「谁用谁持有」搬完后只需同步改源码引用与 `__dirname` 推导（见 §4.3） |
| 目录名 | 统一用 `source/` 而非 `src/` | 仓库内只有一种写法，glob、别名与守卫脚本少一类例外 |
| 任务编排 | Turborepo 接管 | 自己写依赖排序会在每新增一个包时重写一次；turbo 的顺序由依赖图决定，且自带 `dev` 长驻任务语义 |
