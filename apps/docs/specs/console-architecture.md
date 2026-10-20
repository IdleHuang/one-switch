# 控制台架构：业务逻辑与 React 的分工

控制台（`packages/console/source`）只有一条硬约束，其余都从它推出来：

> **业务逻辑不认识 React；React 只是渲染层。**

这条约束不是风格偏好，它决定了一件事——**能不能在没有浏览器的情况下验证一个行为**。诊断执行器要保证「连点两下不会打两批请求出去」、「取消不是失败」，路由规划要保证「同名节点不会互相覆盖」，绑定表要保证「绑定关着时规则也关着」。这些判断全是业务规则，如果它们长在 `useEffect` 和组件状态里，就只能靠点界面来验证；写成不依赖 React 的模块之后，它们各有一份直接的单元测试。

这条约束由 `packages/console/scripts/check-console-layers.mjs` 在 `pnpm lint` 里强制，不是靠自觉（见 §4）。

## 1. 五层与各自能做什么

分层按**依赖方向**划分，不按目录名字划分。同一层的文件之间可以互相 import；跨层只能从下往上要，不能从上往下要。

| 层 | 位置 | 认识什么 | 不认识什么 |
| --- | --- | --- | --- |
| 组装层 | `App.tsx`、`main.tsx`、`routing/`、`pages/*/page.tsx` | 路由、查询客户端、页面拼装、把层与层接起来 | —— |
| 视图层 | `components/`、`pages/*/components/` | React、UI kit、`useTranslation` | `@/api/*`（除类型）、`@tanstack/react-query`（除 `useQueryClient`） |
| 绑定层 | `data/`、`hooks/`、`store/` | React 的取数与状态原语、`@/api/*` | 布局、组件、样式 |
| 领域层 | `lib/`、`catalog/`、`platform/`、`pages/*/lib/` | 纯 TS、业务规则、必要时调 `@/api/*` | **React**、`zustand`、`@tanstack/react-query`、`@/components`、`@/hooks`、`@/shell`、`@/routing` |
| 传输层 | `api/` | `fetch`、契约类型、`unwrap` | React、UI 状态库、上面任何一层 |

**视图层不认识传输层**是这一节最容易被违反、也最值钱的一条。组件一旦能直接 `import { providerModelApi }`，它就会开始自己拼请求、自己 `unwrap`、自己 `try/catch` 弹 toast，而这些逻辑串在组件的生命周期里之后就无法单独验证。所以取数一律下沉到 `data/`：组件只说「我要这个模型的绑定」，不说「去哪个接口拿」。

**领域层不认识 React** 是同一条约束的另一半。领域模块用普通函数与普通类写，React 侧只负责把它的结果画出来、把用户动作调回去。

### 命名约定

- `data/xxx.ts` —— 一个「域」的取数与写入口，内部用 react-query。导出的都是 `useXxx` 查询 hook 与 `xxxAction` 写函数。
- `lib/xxx.ts` —— 纯领域模块：纯函数，或带 `subscribe`/`getSnapshot` 的普通类。测试文件与它并列放在同一目录。
- `pages/<page>/lib/xxx.ts` —— 只服务一个页面的领域规则。够小就别往 `lib/` 提，够用两次就提。

## 2. 有状态但不属于 React：普通类 + 订阅

界面之外仍然有「状态」与「随时间演进的过程」，比如：诊断任务队列跑到了第几个、实时流断线后重连到第几次、轮询在哪些页面之间共享。这些**不是** React 状态，它们有自己的生命周期，必须在组件挂载之前就存在、在组件卸载之后还能被读取。

写法固定为**普通类 + `subscribe`/`getSnapshot`**，不写 `useXxx` 自定义 hook 来承载逻辑：

```ts
export class ModelTestRunner {
  subscribe(listener: () => void): () => void { /* … */ }
  getSnapshot(): ModelTestRunnerSnapshot { /* 稳定引用：没变就返回同一个对象 */ }
  run(tasks: TestTask[], options: TestRunOptions): Promise<void> { /* … */ }
}
```

理由：

- **可测**。`pages/model-management/lib/model-test-runner.test.ts` 直接 `new ModelTestRunner(...)`，让请求挂住、决定它什么时候回、断言并发与取消语义，全程没有 React。
- **可被多处使用**。同一个实例可以同时喂给主界面与托盘面板；hook 做不到这件事——每个 `useXxx` 都是一份新的状态。
- **生命周期不绑在渲染上**。组件卸载不该让正在花钱的诊断任务消失。

`getSnapshot` 必须返回**稳定引用**：没有变化时返回同一个对象，否则 `useSyncExternalStore` 会无限重渲染。

React 一侧只留一个薄适配（`useSyncExternalStore(runner.subscribe, runner.getSnapshot)`），适配里不写任何判断。

## 3. 三条数值口径

这三条在这里展开是因为它们几乎总被写错，而且写错之后没人看得出来。

**只写上下限里「真有必要」的那一个，绝不给用户可配置的参数加上限。** 用户想给某条规则设 600 秒超时，那是他的判断，不是我们的事。缺省值要给，上限不给——除非协议的物理边界（比如某个字段在协议里就是 32 位整数）。

**不知道的值是 `null`，不是 `0`。** 用量还没算出来、耗时还没有样本时，`0` 会被下游当成「测到了，结果为零」。`null` 会一路传到界面上变成「—」。同理，`error: null` 表示「没失败」，`error: ''` 表示「失败了但说不出原因」——这两件事在界面上要显示成不同的东西。

**协议名写全称。** `OpenAI Completions` / `OpenAI Responses` / `Anthropic Messages`，不写 `openai`、`responses`、`anthropic`。这三个名字会直接出现在用户面对的错误信息与日志里，缩写会让人分不清是哪一种。

## 4. 约束怎么被强制

`packages/console/scripts/check-console-layers.mjs` 在 `pnpm lint` 里跑，扫 `packages/console/source` 下除测试文件外的全部源码，把相对路径统一折成别名再比对。违反即退出码 1，并在输出里指明**文件、规则、以及为什么这条规则存在**。

它只守三条边界：

| 规则 | 范围 | 禁止 |
| --- | --- | --- |
| `transport` | `api/**` | React、UI 状态库、`@/(components\|pages\|data\|hooks\|store\|shell\|routing)` |
| `domain` | `lib/**`、`catalog/**`、`platform/**`、`pages/*/lib/**` | React、`zustand`、`@tanstack/react-query`、`@/(components\|hooks\|shell\|routing)`、`@/data` |
| `view` | `components/**`、`pages/*/components/**` | `@/api`（类型导入除外）、`@tanstack/react-query`（`useQueryClient` 除外） |

**为什么只有三条。** 曾经写过第四条「层间 import 顺序」，要求任何文件只能 import 比自己低的层。它在真实代码上产生了一百多条噪声——hook 之间天然互相依赖，`data/` 里的一个查询会用到另一个 `data/` 里的查询，这些都是同层依赖，不是违规。一条护栏如果多数命中都是误报，它就会被人关掉，然后连同真正的问题一起消失。所以这里只留**能被一句话讲清、且违反时一定是错的**那三条。

新增约束前先问：这条规则的每个命中，是不是都真的是缺陷？如果不是，改规则，不要改代码。

## 5. 参考实现

| 主题 | 位置 |
| --- | --- |
| 有状态领域模块的标准写法 | `pages/model-management/lib/model-test-runner.ts` + 同名 `.test.ts` |
| 一个域一个取数入口 | `data/logical-models.ts`、`data/rule-bindings.ts` |
| 纯规则由页面自理 | `pages/logical-models/lib/logical-model-form.ts`、`provider-model-candidates.ts`、`logical-model-writes.ts` |
| 乐观草稿与真实取数并存 | `pages/model-management/components/provider-rule-bindings.tsx` |
| 共享队列 | `lib/task-queue.ts` |
| 护栏本体 | `packages/console/scripts/check-console-layers.mjs` |

页面清单与侧边栏分组仍以 `components/app-sidebar.tsx` 为准（见 [desktop.md](./desktop.md)）；技术栈与构建见 [tech-architecture.md](./tech-architecture.md)。
