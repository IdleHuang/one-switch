# 版本规划与验收标准

本文分为“设计定稿”和“功能待办”两部分。当前实现状态以本文件为最终路线图；仍在执行的工程收尾细节以当前 `main` 分支工程待办为准。新版本按定稿 product 目录从头实施，不以兼容旧代码为目标。

## 一、设计定稿（已完成）

以下设计文档已评审定稿，是后续实施的唯一依据。v0.3 已在 `main` 上按不兼容的新版本契约实施：22 张表数据库基线（后拆为配置/观测两个文件，见「工程演进」S2.3）、公共 Schema、分域 Store、关系模型管理、核心路由、协议适配器、请求观测和管理界面已经完成；当前主要收尾协议转换补充验收、跨平台和正式发布包端到端验证。

当前实现进度：Provider 默认端点已从 Provider JSON 完全迁移到 `provider_endpoints`；ProviderModel 通过端点绑定和 `scheduling_policies` 参与路由；Provider 与 ProviderModel 双层健康冷却已接入候选过滤和请求尝试。

- [x] [data-model.md](./data-model.md)：22 张核心表基线，含 provider_settings、provider_endpoints、provider_model_endpoints、provider_model_health、scheduling_policies、protocol_converters、request_rewrite_rules、provider_model_request_rewrite_rules、workflows、request_logs、request_attributes、request_usages、attempt_usages、request_attempts、request_contents、attempt_contents、runtime_logs；采用标准字段结构化列、多值关系表、受限 JSON 正文/协议详情、请求观测分层、软删除和 Unix 毫秒时间戳。
- [x] [proxy.md](./proxy.md)（外部行为契约）、[proxy-engine.md](./proxy-engine.md)（分层引擎）：代理管线按入口 → 路由 → 尝试规划 → 尝试执行 → 协议/适配 → 传输 → 响应产出 → 观测分层。
- [x] [protocol-conversion.md](./protocol-conversion.md)、[server-architecture.md](./server-architecture.md)、[tech-architecture.md](./tech-architecture.md)、[security-privacy.md](./security-privacy.md)、[observability.md](./observability.md)。

### 当前实现结论（2026-08-22）

- v0.3 的数据库基线、关系模型、分域 Store、路由、协议适配器、请求观测分层、管理 API 和控制台主流程已落地。
- 请求链路统一使用 `client*` / `upstream*` 边界：`clientProtocol` 表示客户端协议，`request_attempts.upstreamProtocol` 表示每次真实远端尝试；正文按视角拆为 `request_contents`（客户端）与 `attempt_contents`（上游）。
- 观测数据遵循两条硬约束：**一张表 = 一个视角**（列名不带视角前缀，用量同样拆为 `request_usages` / `attempt_usages`，不用可空列判别归属）；**事实永远写入、载荷才受开关控制**（协议转换由两侧协议对比得出而不单独建表，是否流式、TTFT、命中的改写规则 id 与尝试级原始 usage 写在 `request_attempts` 上，`captureRequestContent` 关闭时依然完整落库）。
- 完整源码验证已通过：`pnpm typecheck`、`pnpm test`、`pnpm lint`；Vite bundling 也已通过。
- Windows electron-builder 当前受符号链接权限限制，发布包安装验证仍未完成；该环境问题不改变源码验证结论。

### 产品与设计原则（摘要）

- 身份、关系、枚举、开关、数值以及参与路由/查询/排序/统计的字段必须进入关系型列；只有协议私有原始详情、大体积正文和真正开放的扩展数据才使用 JSON/KV。
- v0.3 MVP 只暴露一个兜底逻辑模型 `default`；所有未匹配的非空客户端模型名都由它处理。ProviderModel 通过 `scheduling_policies` 绑定到该逻辑模型，绑定行保存候选顺序、权重和启用状态。后续每个逻辑模型都可以配置自己的 ProviderModel 绑定和顺序；多逻辑模型属于 P2。
- 手动切换只影响后续新请求，不中断已经开始的请求。
- 请求日志分为稳定元数据、远端尝试记录和正文内容三层；正文记录默认开启、可由用户关闭，敏感 Header 必须脱敏，正文不限制大小并完整保存。

## 二、新版本功能待办

### MVP（P0）：核心代理验收

#### 1. 基础代理验证

- [x] 启动应用后，本地端口可访问
- [x] 所有工具统一配置 Base URL 为 `http://127.0.0.1:port`，无需按协议区分
- [x] OpenAI 工具请求 `/v1/chat/completions`，代理自动识别为 openai 协议并透传到当前逻辑模型的对应 ProviderModel
- [x] Anthropic 工具请求 `/v1/messages`，代理自动识别为 anthropic 协议并透传到当前逻辑模型的对应 ProviderModel
- 暂不支持：Gemini `/v1beta/models/*` 协议代理
- [x] 请求 `/v1/models` 返回唯一启用的 `default`，不透传到上游
- [x] 请求体 `model` 缺失、空值或非字符串时返回明确的模型参数错误；任意其他非空模型名由 `default` 处理
- [x] 流式请求能持续返回 SSE 数据，不被代理缓冲破坏
- [x] 多工具并发请求时，日志记录和健康状态更新无错乱

#### 2. 自动切换候选验证

- [x] 候选列表中只有 openai 协议的项；通过 anthropic 协议请求时，返回"当前协议下无可用 ProviderModel"
- [x] 候选列表中同时有 openai 和 anthropic 的项；通过 openai 请求时只尝试 openai 项，通过 anthropic 请求时只尝试 anthropic 项
- [x] 请求体中任意非空 `model` 字段都会由 `default` 逻辑模型处理，转发到远端后被替换为当前候选的 `modelName`
- [x] 候选第一项失败（不可达），自动切换到第二项并成功返回

#### 3. 错误分类与自动切换验证

- [x] 候选第一项不可达（网络错误），自动切换到第二项并成功返回
- [x] 候选第一项返回 429 或 500，自动切换到第二项
- [x] 候选第一项返回 401，切换并在控制台提示该 Provider 鉴权可能异常
- [x] 上游返回 400 请求错误时，不切换，直接返回客户端错误

#### 4. 手动切换验证

- [x] 在控制台手动切换到候选第二项，新发起的请求从第二项开始尝试
- [x] 手动切换时，正在进行的流式请求不中断，继续使用原 ProviderModel 完成
- [x] 手动切换到的 ProviderModel 失败后，仍按候选顺序自动往下切换
- [x] 手动切换不改变候选的优先级顺序
- [x] 重启应用后，当前手动指定的 ProviderModel 重置为候选第一项

#### 5. 流式边界验证

- [x] 上游在响应头前失败，自动切换
- [x] 上游已经返回 200 和部分 SSE 后断开，不切换到其他供应商，记录失败

#### 6. 健康状态验证

- [x] 连续失败达到阈值后供应商进入冷却，后续请求跳过它
- [x] Provider 级 401/403、端点级认证失败和明确的 Provider 网络故障更新 Provider 健康；模型不存在/模型级 4xx 更新 ProviderModel 健康
- [x] 429 的健康归属按错误响应可判定范围记录：Provider 明确限流时更新 Provider，否则更新 ProviderModel
- [x] 冷却结束后，新请求允许再次尝试该供应商
- [x] 成功请求后连续失败计数重置

#### 7. 安全与隐私验证

- [x] 服务默认只监听 `127.0.0.1`
- [x] 网络可达性由监听地址与操作系统防火墙负责：`listenHost` 可由用户改为 `0.0.0.0` / `::` 以暴露给局域网 / WSL / 容器，**不做 Host 头白名单校验**（原「拒绝不允许的 Host」条目已按此决策撤销，见 [security-privacy.md](./security-privacy.md)）
- [x] 若启用本地 Bearer Token，代理和管理 API 按明确配置边界校验 Token；Token 只存系统密钥环，并覆盖生成、轮换、删除和失效测试
- [x] 导出供应商包时 API Key 默认脱敏（包含明文需显式勾选并提示）
- [x] 本地日志中不出现明文密钥；正文记录关闭时不保存完整请求体和响应体
- [x] 关闭应用后代理端口释放
- [x] 开机自启设置生效

#### 8. 跨平台验证

- [ ] macOS 菜单栏图标、菜单和控制台可用
- [ ] Windows 托盘图标、菜单和控制台可用

### MVP（P0）：请求正文调试能力

- [x] 代理链路采集客户端请求和最终响应正文
- [x] 在 `attempt_contents` 中按 `attemptId` 采集每次上游尝试的请求、响应和错误正文（客户端侧正文在 `request_contents`）
- [x] 采集协议转换前后的请求/响应内容
- [x] 通过 `/api/request-log/detail` 按需查询 request-level 与 attempt-level 正文
- [x] 增加 `RequestContentSchema` 和正文 CRUD/映射逻辑
- [x] 在日志详情中展示完整正文、转换前后内容和上游尝试
- [x] 验证正文记录关闭时不写入完整请求体和响应体
- [x] 验证敏感 Header 在入库和展示前均已脱敏
- [x] 请求与响应正文全量保存；流式记录保存全部原始 chunk，不聚合或截断，存储占用通过手动清理和自动保留策略控制
- [x] 采集与保留拆成两个独立维度：`captureRequestLogs` / `captureRequestContent` 各一个开关，`requestLogRetentionDays`（默认 `0`，永久）与 `contentRetentionDays`（默认 `7` 天）各一个时间窗
- [x] 删除语义分层：请求日志过期级联删除正文/尝试/用量，正文过期只删正文并保留请求行与指标；正文被清理的记录在详情中显式提示
- [x] “清理历史日志”支持分别输入请求日志与请求响应正文的保留天数并立即执行，不改动自动保留设置
- [x] 请求日志每条记录支持复制完整 cURL（含正文，无损转义）

### MVP（P0）：供应商连通性测试

- [x] 模型管理页提供“连接测试”入口，向上游发送最小请求验证可用性
- [x] 测试结果展示成功/失败及错误原因（鉴权失败、网络不可达、超时等）
- [x] 渠道诊断面板重做：进度与结果统计常驻、失败过滤与重试失败、清空结果、真实 token 用量（无数据显 `—`）
- [x] 诊断请求的载荷按协议对齐：OpenAI 协议不带输出上限，Anthropic 直连补最小 `max_tokens`（避免转换层默认 4096 带来的成本）
- [x] 客户端中止诊断时正常收尾并返回已完成的尝试结果，不再出现无响应

### MVP（P0）：代理管线收尾

- [x] 抽出基础传输层（现为 `proxy/transports/http.ts`），隔离 Node.js HTTP/HTTPS 请求调用并覆盖基础测试
- [x] 建立共享 request context，统一请求 ID、协议、取消信号和生命周期数据
- [x] 建立 ProtocolAdapter 类型、注册表与 OpenAI Completions、OpenAI Responses、Anthropic Messages 适配边界
- [x] 将模型改写、usage 注入、请求/响应转换和流式转换迁移到 adapter 或转换器注册表
- [x] 将超时、客户端中止、SSE 和响应头生命周期下沉到 transport
- [x] 明确并完成 attempt、usage 和正文采集 hooks 与持久化 logger 的责任边界
- [x] 收敛请求入口和尝试编排，使其负责候选编排、尝试循环、错误分类和生命周期收尾

### MVP（P0）：正式发布验收

- [x] `pnpm typecheck`、`pnpm test:server`、`pnpm lint` 和 Vite bundling 已通过；Windows electron-builder 仍受符号链接权限限制
- [x] 已生成 `0.3.0-beta.1` macOS arm64 DMG/zip，并通过 ad-hoc 签名校验
- [ ] 使用全新用户数据目录完成发布包首次启动和空数据库初始化
- [ ] 在发布包内完成 Provider 配置、OpenAI/Anthropic 请求、故障转移、日志与正文查看端到端验收
- [ ] 完成 macOS arm64/x64 菜单栏、菜单、控制台、开机自启和退出验收
- [ ] 完成 Windows x64 构建及安装、托盘、控制台和退出验收
- [ ] 清理旧测试术语和过时文档状态
- [ ] 更新正式版本号、发布说明与更新元数据

## P1

### 国际化（i18n）

完整设计见 [i18n.md](./i18n.md)。核心约束：**界面文案可切换语言，日志与错误固定英文。** 阶段 1 为硬需求。

- [ ] 阶段 0：`SettingsSchema` 增 `language`、i18n 核心、目录骨架、`I18nProvider`、设置页语言行
- [ ] 阶段 1：日志与错误英文化（`errors.ts`、管理 API、代理层、运行日志），错误码收窄为 `ApiErrorCode`，渲染层按错误码本地化
- [ ] 阶段 2：外壳与通用组件（侧栏、layout、设置页、通用表单 / 列表状态）
- [ ] 阶段 3：业务页逐页迁移（overview / request-logs / logs / logical-models / model-management / router / request-rewrite-rules / access-config）
- [ ] 阶段 4：原生托盘 / 菜单 / 对话框本地化
- [ ] 阶段 5：门禁与清理（`no-hardcoded-cjk` ESLint 规则、目录一致性检查、移除硬编码中文）

### 范围

- [x] 日志筛选已支持状态、逻辑模型、协议、供应商和时间范围，并保持 list/count 条件一致；请求 ID 贯穿仍待补齐
- [x] 冷却/熔断状态可视化：逻辑模型页展示冷却状态与连续失败次数徽标
- [x] 供应商包备份/恢复：按供应商导出/导入端点、模型与自定义设置，密钥仅存系统密钥环
- [ ] Token 用量统计：按 `request_usages.type` 聚合展示今日/本周用量（基础指标已存在，产品口径与专用 UI 仍需确认）
- [ ] 协议兼容转换器补充验收（详见 [protocol-conversion.md](./protocol-conversion.md)）：核心转换和 UI 已落地，转换候选故障切换、转换错误 400、流式转换异常及各方向发布包验收仍待补齐
- [x] 代理引擎（设计详见 [proxy-engine.md](./proxy-engine.md)）：协议矩阵收敛到单一描述符注册表，内核没有协议与 HTTP 分支，重写/转换/日志/用量/健康落位为 Modifier 与 Observer 插件；双向传输能力预留在内核，当前没有实现、也不在计划内
- [x] 上游出站代理设置（详见 [outbound-proxy.md](./outbound-proxy.md)）：HTTP/HTTPS/SOCKS 代理、绕过规则、草稿连接测试，覆盖模型请求与模型列表获取
- Linux 打包与托盘体验完善
- 更细粒度的错误切换策略配置
- [x] 日志导出

## P2

### 请求重写模块

行为契约、实现状态与剩余项：[request-rewrite-rules.md](./request-rewrite-rules.md)（§12 分阶段实施状态）

- [x] 规则模型已冻结并实现：全局规则与 ProviderModel 绑定、绑定顺序（`priority`）、启停，以及「失败即阻断当前 attempt」语义
- [x] 请求阶段动作与非流式响应阶段动作已生效；`stage` 是动作级字段，不是匹配条件
- [x] Header 动作、受限 JSON Path 动作与 `User-Agent` 场景已落地
- [ ] 三种协议的 thinking/reasoning 字段矩阵，以及 OpenAI Responses、Anthropic Messages 的人工验收
- [ ] 请求日志中的规则执行摘要与响应字段修改安全审计
- [ ] 流式事件级规则（仅在独立设计评审通过后实施）

### 范围

- 请求级路由解释：日志详情展示候选列表快照与每项被跳过的原因（协议不匹配/冷却中/已禁用）
- 多逻辑模型支持（模型列表、模型别名、按逻辑模型配置独立候选池；`default` 作为默认聚合模型）
- 更多协议路径预设（Ollama 本地、OpenRouter、Azure 等）
- 按延迟、成功率、权重或成本的智能路由
- 主动健康探测
- 多配置 Profile
- 本地 CLI 或无头模式（设计、包边界与阶段验收见 [packaging.md](./packaging.md)，进度见下文「工程演进」）

## 工程演进：包拆分与多形态分发（S0–S4）

目标是把核心能力拆成包，让同一套能力同时服务 CLI 与桌面 App 两种形态。设计、包边界、目录映射与宿主适配点以 [packaging.md](./packaging.md) 为唯一权威；本节的勾选状态是该计划的进度来源。

- [x] S0 骨架平移（不改逻辑）：建立 pnpm workspace 与 `packages/{contracts,core,console}` 三个库包 + `apps/app` 宿主壳，按迁移映射表平移目录与导入别名，并顺手完成根目录清理——目录名统一为 `source/`、脚本按业务归入各包 `scripts/`（跨包的收在 `packages/toolkit/scripts/`）、打包资产按「谁用谁持有」进 `apps/app/`、turbo 接管任务编排。验收结果：`pnpm typecheck` / `pnpm lint` / `pnpm test` 全过（109 文件 / 1123 测试，与平移前一致）、`pnpm build` 2 个 turbo 任务通过、`pnpm dev` 端到端复验通过（详见 [packaging.md](./packaging.md) §7 S0）
- [ ] S1 `core` 可独立运行：`core` / `contracts` 产出独立构建产物，新增裸 Node 冒烟脚本。验收：不安装 Electron 的 Node 进程能启动服务、完成一次成功转发与一次失败切换，并能干净退出。**本轮跳过**：CLI 选择直接用 Vite 别名打包 `core` / `contracts` 的**源码**，不依赖它们产出独立 ESM 产物，因此没有驱动这一阶段的需求；留到真有第三方单独消费 `core` 时再做
- [x] S2 CLI 成型：落地密钥存储、Web 托管、前端运行时注入、桌面能力抽象与运行时配置（[packaging.md](./packaging.md) §5.1–§5.5），建立 `apps/cli` 并实现 `start` / `stop` / `status` / `version`。验收：`node apps/cli/dist/index.js start` 之后浏览器可打开完整控制台、控制台到管理 API 全链路可达，`stop` 后端口释放（结果与实测数据见 [packaging.md](./packaging.md) §7 S2）。**未包含**：`config` 子命令、`--daemon`，以及 §7 S4 的发布形态
- [x] S2.1 CLI 生产级细节：单实例互斥（`instance.lock`）与崩溃兜底、`status --json`、端口/版本漂移诊断、非回环监听的安全告警，以及 9 步真实子进程冒烟脚本 `pnpm smoke:cli`。验收：`pnpm smoke:cli` 9/9 通过，`pnpm test`（116 文件 / 1197 测试）、`pnpm typecheck`、`pnpm lint` 全绿（详见 [packaging.md](./packaging.md) §7 S2.1）
- [x] S2.2 两种形态的一致性：命令行与桌面形态必须是「同一套服务、同一份数据，只是驱动方式不同」。修掉 Linux 上数据目录分叉（命令行的 `$XDG_CONFIG_HOME/one-switch` vs 桌面形态的 `~/.config/One Switch`）：目录名一律取 `runtimeProfile.dataDirectoryName`，平台 appData 目录抽成可单测的纯函数（后来这个纯函数在 S2.3 里连同「按平台算 appData 目录」一起被删掉了）；修掉两种形态在同一数据目录里写同名 `secrets.json` 的问题（密文算法不同，同名会让后写的把前一份密钥全部作废）；把「一致 / 能力差异 / 形态差异」三类逐项列清（见 [packaging.md](./packaging.md) §6「与桌面形态的一致性」）。验收：新增 7 个用例；`pnpm test`（116 文件 / 1204 测试）、`pnpm typecheck`、`pnpm lint`、`pnpm build`、`pnpm smoke:cli`（9/9）全绿
- [x] S2.3 数据落在用户主目录 + 配置与观测拆成两个库：数据库文件从 `<平台 appData>/<目录名>` 改成 `<用户主目录>/.one-switch`（开发档 `~/.one-switch-development`）；单个 `one-switch-v<应用主版本>.db` 拆成 `one-switch-config-<n>.db` / `one-switch-data-<n>.db`，两份 schema、两条 Drizzle 链、两份 `drizzle.config.<role>.ts`，跨库外键全部移除（健康行改为惰性创建 + 启动时清理孤儿行），文件名里的版本号改为两个独立的 schema 版本常量；新增库边界守卫 `check-database-boundaries.mjs` 并入 `pnpm lint`。明确不考虑兼容与历史：换代只换文件名，没有迁移，也没有任何版本检测代码。验收：`pnpm typecheck` / `pnpm lint` / `pnpm test`（116 文件 / 1210 测试）/ `pnpm build` / `pnpm smoke:cli` 全绿，无参启动的真实产物确实在 `~/.one-switch` 下建出两个库文件（详见 [packaging.md](./packaging.md) §7 S2.3）
- [x] S2.4 宿主与实例身份收口：把三条「只在某一个宿主/某一条路径上成立」的保证收进 core——实例互斥从 `apps/cli` 移到 `packages/core/source/runtime/instance-lock.ts` 并由 `startServer` 在绑定端口前取锁（顺便把存活判定从「pid 活着」改成「pid 活着且心跳新鲜」），新增 `runtime/runtime-identity.ts` 为每次启动生成内存态实例 Token 并让 `/api/*` 一律校验、统一守卫 `management/core/request-guards.ts` 收口鉴权与跨域，桌面形态补上 `app.requestSingleInstanceLock()` 与异步 `before-quit`；同一轮还修掉代理的失败归因（双向形态不符、流中途截断）、观察者隔离、下游背压、`accept-encoding` 协商、协议固定头丢失，以及控制台的查询键撞车、监听器泄漏与加载失败静默；收口时又把两处「宿主自己动手」的地方一并拆掉——`stop` 不再清残留锁（接管只发生在取锁那一刻），管理接口与代理入口的请求体上限整个撤掉（本地工具，不做资源消耗攻击假设）；同一次收口里还把请求头改成**默认转发**——只有鉴权、逐跳头、与位置绑定的 `host`/`content-length` 和 `accept-encoding` 会被动，其余（官方接口那些 `openai-beta` / `anthropic-beta` / `x-stainless-*` 之类的自定义头）原样透传，协议固定头拆成「该覆盖」与「只补缺」两半。验收：`pnpm typecheck` / `pnpm lint` / `pnpm test`（116 文件 / 1235 测试）/ `pnpm build:cli` / `pnpm smoke:cli`（9/9）全绿（详见 [packaging.md](./packaging.md) §7 S2.4）
- [ ] S3 App 回归：`app` 改为消费 `core` + `console`，托盘 / 自动更新 / 开机自启 / 原生对话框保持（`electron-builder` 配置与打包脚本已在 S0 迁入包内，本阶段只剩构建产物映射与 `apps/app/source` 的 `main/` / `preload/` 细分）。验收：桌面安装包端到端可用且升级路径不回归
- [ ] S4 分发与文档：CLI 以 npm 全局 bin 分发并声明 `engines`；`tech-architecture.md`、`server-architecture.md` 与本节同步（CLI 侧「暂不发布」是当前明确决定，见 [packaging.md](./packaging.md) §7 S4）

已落地的工程前置：在既有分层守卫之外新增包边界守卫 `packages/toolkit/scripts/check-package-boundaries.mjs`（随 `pnpm lint` 执行），强制 `packages/*` 与 `apps/*` 之间的依赖方向。规则里预留的 CLI 分支已在 S2 建立 `apps/cli` 时自动生效（`RULES.cli`：禁止依赖 `console` 与 `app`、禁止 `electron`）。
