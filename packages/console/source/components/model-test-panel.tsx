import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Cpu,
  FlaskConical,
  Gauge,
  Play,
  Repeat,
  RotateCcw,
  Search,
  Settings2,
  Square,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import { formatMilliseconds, formatOutputSpeed, formatTokenCount } from '@common/metrics'
import { ALL_MODEL_TEST_MODES, type ModelTestMode, type Protocol, type Provider, type ProviderModelRoute } from '@common/schemas'
import type { UiCatalogKey } from '@common/i18n/catalogs'
import { CONVERTIBLE_PROTOCOLS, PROTOCOL_DISPLAY_NAMES } from '@common/protocols'
import { modelTestApi, type ModelTestResult, type ModelTestRoundResult } from '@/api/tools'
import { InlineEmptyState } from '@/components/inline-empty-state'
import { FormRow } from '@/components/form-kit'
import { PROTOCOL_ICONS } from '@/components/protocol-icons'
import { TableFrame, TableHeaderSurface, tableRowClass } from '@/components/table-primitives'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useTranslation, type AppTranslator } from '@/i18n/provider'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

interface ModelTestPanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  models: ProviderModelRoute[]
  providers: Provider[]
}

type TestTaskStatus = 'queued' | 'running' | 'success' | 'failed' | 'cancelled'

interface TestTask {
  id: string
  modelId: string
  modelName: string
  providerId: string
  providerName: string
  protocol: Protocol
  converted: boolean
  status: TestTaskStatus
  result?: ModelTestResult
  errorMessage?: string
}

const TEST_CONCURRENCY = 3

/**
 * 测试参数。
 *
 * 它们只影响**这一次诊断怎么写请求**，不进服务端配置：并发是界面侧的 worker 数，
 * 轮次与提示词是随每次 `/model-test/run` 走的值。
 */
interface TestConfig {
  concurrency: number
  rounds: number
  inputLength: number
  prompt: string
}

const DEFAULT_TEST_CONFIG: TestConfig = {
  concurrency: TEST_CONCURRENCY,
  rounds: 1,
  inputLength: 0,
  prompt: '',
}

/** 并发上限与服务端的轮次上限同源口径：这是诊断，不是压测。 */
const MAX_TEST_CONCURRENCY = 10
const MAX_TEST_ROUNDS = 5
const MAX_TEST_PROMPT_LENGTH = 20_000

/**
 * 结果表列宽模板：表头与数据行共用一份，避免两处列宽只改一半。
 *
 * **一格只放一个事实。** 原先最后一格是「HTTP 404 ↓1234」：协议结论（上游回了什么）
 * 与产出量（出了多少 Token）是两个量纲，挤在一格里读起来像一句话，横向比对时又只能
 * 整格扫——两列数据都等于没有列。现在 HTTP 状态回到它自己的「状态」列，输出 Token
 * 单独一列，与首字、耗时、速度三列并排，四个数字右对齐、等宽数字，扫一眼就能竖着比。
 *
 * 协议**单独成列**：色条只能表达「这条是转出来的」，说不出「测的是哪个协议」。
 * 一行就是一个「模型 × 协议」，扫结果时最常见的提问就是「哪个协议挂了」，所以它值这一列。
 *
 * 最左边那 20px 是展开箭头：每行都能展开逐轮明细（轮次、成功率、错误原文）。
 * 箭头单独占一列而不是塞进状态格，是因为状态格要能一眼竖着扫下来，多一个交互形状就扫不动。
 *
 * 列对所有模式都在：连通性只能填 `—`，但列数不跟着数据变——同一张表在三种模式之间
 * 来回切时列宽就不该跳。
 *
 * 窄屏（< md）落回单列堆叠，那时行里每格自带标签（{@link TaskCell} 的 `labelKey`），
 * 因为表头整条藏起来了。
 */
const TASK_GRID_COLUMNS = 'md:grid-cols-[20px_minmax(150px,1.4fr)_minmax(120px,0.9fr)_66px_62px_64px_64px_64px]'

/**
 * 逐轮记录的**唯一来源**：新服务端给 `result.rounds`，老服务端只给一条总账。
 *
 * 两种都要能展开，所以老数据就地补成「第 1 轮」——用同一条渲染路径，不写两套明细表，
 * 也不因为服务端版本不同而让「点开看看」有时有内容、有时空白。
 */
function getResultRounds(result: ModelTestResult): ModelTestRoundResult[] {
  if (result.rounds?.length) return result.rounds
  return [{
    round: 1,
    success: result.success,
    statusCode: result.statusCode,
    durationMilliseconds: result.durationMilliseconds,
    errorMessage: result.errorMessage,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    ttftMilliseconds: result.ttftMilliseconds,
    tokensPerSecond: result.tokensPerSecond,
  }]
}

const TEST_MODE_LABEL_KEYS: Record<ModelTestMode, UiCatalogKey> = {
  connectivity: 'modelTest.mode.connectivity',
  streaming: 'modelTest.mode.streaming',
  speed: 'modelTest.mode.speed',
}

const TEST_MODE_HINT_KEYS: Record<ModelTestMode, UiCatalogKey> = {
  connectivity: 'modelTest.mode.connectivityHint',
  streaming: 'modelTest.mode.streamingHint',
  speed: 'modelTest.mode.speedHint',
}

const TASK_STATUS_LABEL_KEYS: Record<TestTaskStatus, UiCatalogKey> = {
  queued: 'modelTest.status.queued',
  running: 'modelTest.status.running',
  success: 'modelTest.status.success',
  failed: 'modelTest.status.failed',
  cancelled: 'modelTest.status.cancelled',
}

function getTestableProtocols(model: ProviderModelRoute): Protocol[] {
  const protocols = new Set(model.endpoints.map(endpoint => endpoint.protocol))
  for (const endpoint of model.endpoints) {
    if (!endpoint.protocolConversionEnabled) continue
    for (const protocol of CONVERTIBLE_PROTOCOLS[endpoint.protocol]) protocols.add(protocol)
  }
  return [...protocols]
}

function supportsConvertedProtocol(model: ProviderModelRoute, protocol: Protocol): boolean {
  return !model.endpoints.some(endpoint => endpoint.protocol === protocol)
    && model.endpoints.some(endpoint => endpoint.protocolConversionEnabled && CONVERTIBLE_PROTOCOLS[endpoint.protocol].includes(protocol))
}

interface ProtocolSegmentState {
  converted: boolean
  selected: boolean
}

interface ProtocolSegmentLabelOptions {
  converted: boolean
  protocol: Protocol
  t: AppTranslator
}

/**
 * 协议分段控件的**底座**：一条凹槽（`bg-inset`），放这个模型的全部可测协议。
 *
 * 之所以从「各自独立的胶囊」改成一条槽里的分段：原来每个协议是一颗浅灰描边小方块，
 * 横着排开像三个不相干的标签；改成一条槽里的分段后，「这几个是同一个人身上的选项、
 * 只有几个能亮」才在形状上说清楚——这跟「渠道里的模型」是同一类多选关系。
 *
 * 槽本身会**换行**（`flex-wrap`）：协议名一律用正式写法（`OpenAI Completions`），
 * 三个满名并排在 340px 的侧栏里排不下，宁可多占一行，不减字——缩写会引出第二个叫法，
 * 而同一个概念有两种写法比多一行代价大得多（见 `PROTOCOL_DISPLAY_NAMES` 的说明）。
 *
 * 用 `bg-inset` 而不是描边：描边要画六条边，凹槽只画一层底色；同一屏里的灰盒子越少越好。
 */
const PROTOCOL_TRACK_CLASS = 'inline-flex flex-wrap items-stretch gap-0.5 rounded-md bg-inset p-0.5'

/**
 * 一个协议分段：`字形 + 协议正式名`（`OpenAI Completions`）。
 *
 * 名字不省：槽里排不下时就换行。以前这里印的是短名（`Completions`），理由是一个模型行
 * 里重复三遍厂商名太啰嗦；但省下那截以后，同屏里的协议就出现了两种写法——旁边列着
 * `OpenAI Responses`，这里写着 `Responses`，读者得自己判断它们是不是同一个东西。
 * 省字的地方用换行解决，不用减字。
 *
 * 三态各有各的长相，不再靠同一个形状换底色：
 * - 选中：抬起成 `bg-card` + 主文色（凹槽里唯一浮起来的东西）。
 * - 未选中：只给文字，连底色都不给——给每个分段铺一层浅底会在列里排出七个灰方块。
 * - 转换（`converted`）：warning 色 + `Repeat` 记号。整条槽里最该被注意的是它，
 *   因为它意味着请求会被改写，而不是照原样送出去。
 */
function getProtocolSegmentClassName(state: ProtocolSegmentState): string {
  if (state.converted) {
    return state.selected
      ? 'bg-warning/15 text-text-warning'
      : 'text-text-warning hover:bg-warning/10'
  }
  if (state.selected) return 'bg-card text-text-primary'
  return 'text-text-tertiary hover:bg-state-base-hover hover:text-text-primary'
}

function getProtocolSegmentLabel(options: ProtocolSegmentLabelOptions): string {
  const label = PROTOCOL_DISPLAY_NAMES[options.protocol]
  return options.converted ? options.t('protocol.conversion.aria', { protocol: label }) : label
}

/**
 * 输出列只放**上游报出来的输出 Token**。
 *
 * 没报就是没报：写 `—`，不补一个 `0`——「上游没说」和「一个字都没出」是两件事，
 * 按 0 展示会把前者算进后者的口径里。输出速度列的分母与它同源，两列并排读得通。
 */
function getTaskTokenLabel(task: TestTask): string {
  return task.result ? formatTokenCount(task.result.outputTokens) : '—'
}

function getTaskDurationLabel(task: TestTask): string {
  return task.result ? formatMilliseconds(task.result.durationMilliseconds) : '—'
}

/** 首字耗时只量得到流式：整包响应里没有「第一块」这个时刻，没量到就写 `—`，不编一个 0。 */
function getTaskTtftLabel(task: TestTask): string {
  return task.result ? formatMilliseconds(task.result.ttftMilliseconds) : '—'
}

/** 出字速度只有速度诊断会给：其余模式里分母是两个数减出来的，宁缺勿编。 */
function getTaskSpeedLabel(task: TestTask): string {
  if (!task.result) return '—'
  const speed = formatOutputSpeed(task.result.tokensPerSecond)
  return speed === '—' ? '—' : `${speed} t/s`
}

interface ProtocolSegmentProps {
  converted: boolean
  disabled: boolean
  protocol: Protocol
  selected: boolean
  title: string
  onToggle: () => void
}

/** 槽里的一个协议分段。`role="checkbox"` 是拿来表达三态（行级那圈求和出来的半选）的。 */
function ProtocolSegment(props: ProtocolSegmentProps) {
  const Icon = PROTOCOL_ICONS[props.protocol]
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={props.selected}
      aria-label={props.title}
      title={props.title}
      disabled={props.disabled}
      className={cn(
        'inline-flex items-center gap-1 rounded-[5px] px-1.5 py-0.5 system-2xs-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        getProtocolSegmentClassName({ converted: props.converted, selected: props.selected }),
      )}
      onClick={props.onToggle}
    >
      {props.converted ? <Repeat size={9} aria-hidden className="shrink-0" /> : <Icon size={11} aria-hidden className="shrink-0" />}
      {PROTOCOL_DISPLAY_NAMES[props.protocol]}
    </button>
  )
}

interface ModelSelectionProps {
  running: boolean
  allTasksSelected: boolean
  availableProviders: Provider[]
  selectedProviderIds: Set<string>
  enabledModels: ProviderModelRoute[]
  selectedModelProtocols: Record<string, Set<Protocol>>
  onToggleAll: () => void
  onToggleModel: (modelId: string) => void
  onToggleProvider: (providerId: string) => void
  onToggleModelProtocol: (modelId: string, protocol: Protocol) => void
}

function ModelSelection(props: ModelSelectionProps) {
  const t = useTranslation()
  const [query, setQuery] = useState('')
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const providerViews = useMemo(() => props.availableProviders.map(provider => {
    const selected = props.selectedProviderIds.has(provider.id)
    const models = props.enabledModels
      .filter(model => model.providerId === provider.id)
      .filter(model => !normalizedQuery
        || provider.name.toLocaleLowerCase().includes(normalizedQuery)
        || model.modelName.toLocaleLowerCase().includes(normalizedQuery))
      .map(model => {
        const protocols = getTestableProtocols(model)
        const selectedProtocols = props.selectedModelProtocols[model.id] ?? new Set(protocols)
        const selectedCount = protocols.filter(protocol => selectedProtocols.has(protocol)).length
        return {
          model,
          selectedCount,
          /*
           * 「整行」的勾选态由协议逐个求和得来，不另存一份。
           * 一份状态两处表达，迟早会出现「行说全选、药丸只剩两个」的对不上。
           */
          selected: protocols.length > 0 && selectedCount === protocols.length,
          indeterminate: selectedCount > 0 && selectedCount < protocols.length,
          protocols: protocols.map(protocol => {
            const converted = supportsConvertedProtocol(model, protocol)
            return {
              protocol,
              converted,
              selected: selectedProtocols.has(protocol),
              title: getProtocolSegmentLabel({ converted, protocol, t }),
            }
          }),
        }
      })
    return {
      provider,
      selected,
      models,
      selectedCount: models.filter(model => model.selectedCount > 0).length,
    }
  }).filter(view => view.models.length > 0), [normalizedQuery, props.availableProviders, props.enabledModels, props.selectedModelProtocols, props.selectedProviderIds, t])

  return (
    <aside className="flex min-h-0 flex-col border-b border-border/60 bg-card lg:border-r lg:border-b-0">
      {/* 头部与搜索不铺底色，靠底部发丝线跟列表分开（左侧栏原本整块 `bg-inset`，是这页最主要的灰盒子）。 */}
      <div className="grid shrink-0 gap-3 px-4 py-3.5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="system-xs-medium text-text-primary">{t('modelTest.selection.title')}</div>
            <div className="mt-0.5 system-2xs-regular text-text-tertiary">{t('modelTest.selection.description')}</div>
          </div>
          <Button variant="ghost" size="xs" disabled={props.running || props.enabledModels.length === 0} onClick={props.onToggleAll}>
            {props.allTasksSelected ? t('modelTest.selection.clear') : t('common.action.selectAll')}
          </Button>
        </div>
        <div className="relative">
          <Search size={13} aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-text-quaternary" />
          <Input
            value={query}
            disabled={props.running}
            onChange={event => setQuery(event.target.value)}
            placeholder={t('modelTest.selection.searchPlaceholder')}
            className="pr-3 pl-7.5"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 divide-y divide-border/60 overflow-y-auto border-t border-border/60">
        {providerViews.map(providerView => (
          <section key={providerView.provider.id}>
            <div className="flex items-center gap-2.5 px-4 py-2.5">
              <Checkbox
                checked={providerView.selected}
                disabled={props.running}
                aria-label={providerView.provider.name}
                onCheckedChange={() => props.onToggleProvider(providerView.provider.id)}
              />
              <button
                type="button"
                disabled={props.running}
                className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-not-allowed"
                onClick={() => props.onToggleProvider(providerView.provider.id)}
              >
                <span className="min-w-0 flex-1 truncate system-xs-medium text-text-primary">{providerView.provider.name}</span>
                <span className="shrink-0 font-mono system-2xs-regular tabular-nums text-text-quaternary">{t('modelTest.selection.modelCount', { count: providerView.models.length })}</span>
              </button>
            </div>

            {providerView.selected && (
              <div className="grid gap-2.5 px-4 pb-3 pl-10">
                {providerView.models.map(modelView => (
                  <div key={modelView.model.id}>
                    {/*
                     * 一行定一个模型。选中供应商之后，逐个点分段挑协议很费手（每段只有
                     * 二十来像素宽），于是补一个整行级别的勾选：勾选框本身、模型名、
                     * 右侧计数三处都走同一个开关。分段保留，它才是细粒度控制；
                     * 只是在「一个模型只想测一个协议」之前不必用它。
                     */}
                    <div className="mb-1.5 flex items-center gap-2">
                      <Checkbox
                        checked={modelView.indeterminate ? 'indeterminate' : modelView.selected}
                        disabled={props.running}
                        aria-label={t('modelTest.selection.modelAria', { name: modelView.model.modelName })}
                        onCheckedChange={() => props.onToggleModel(modelView.model.id)}
                      />
                      <button
                        type="button"
                        disabled={props.running}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-not-allowed"
                        onClick={() => props.onToggleModel(modelView.model.id)}
                      >
                        <span className="min-w-0 flex-1 truncate font-mono system-2xs-regular text-text-secondary">{modelView.model.modelName}</span>
                        {/*
                         * 计数要带单位。裸 `2/3` 排在模型名右边，读者第一反应是
                         * 「三个模型里选了两个」——可这里模型只有一行，被数的是协议。
                         */}
                        <span className="shrink-0 system-2xs-regular tabular-nums text-text-quaternary">
                          {t('modelTest.selection.protocolCount', { selected: modelView.selectedCount, total: modelView.protocols.length })}
                        </span>
                      </button>
                    </div>
                    <div className={PROTOCOL_TRACK_CLASS}>
                      {modelView.protocols.map(protocolView => (
                        <ProtocolSegment
                          key={`${modelView.model.id}:${protocolView.protocol}`}
                          converted={protocolView.converted}
                          disabled={props.running}
                          protocol={protocolView.protocol}
                          selected={protocolView.selected}
                          title={protocolView.title}
                          onToggle={() => props.onToggleModelProtocol(modelView.model.id, protocolView.protocol)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        ))}
        {providerViews.length === 0 && (
          <InlineEmptyState
            title={props.enabledModels.length === 0 ? t('modelTest.empty.noModels') : t('modelTest.selection.empty')}
            className="px-3 py-10"
          />
        )}
      </div>
    </aside>
  )
}

interface TestProgressProps {
  cancelledCount: number
  completedCount: number
  failureCount: number
  progress: number
  running: boolean
  successCount: number
  totalCount: number
}

interface TestTaskRowProps {
  task: TestTask
  expanded: boolean
  onToggleExpanded: () => void
}

/** 展开体只接一条已完成的结论：没有 `result` 的行没有逐轮可看。 */
interface TestTaskDetailProps {
  task: TestTask
}

interface EmptyTestTasksProps {
  hasEnabledModels: boolean
}

/**
 * 常驻状态块。
 *
 * 无论是否跑过都渲染同一套骨架（状态文案 + 四个计数 + 进度条 + 费用提示），
 * 只是空值落回 `0` / 尚未开始：这样点「开始诊断」时页面不会突然多出一整条横幅。
 */
function TestProgress(props: TestProgressProps) {
  const t = useTranslation()
  const status = props.running
    ? t('modelTest.progress.running')
    : props.completedCount === 0
      ? t('modelTest.progress.idle')
      : props.failureCount > 0
        ? t('modelTest.progress.failed')
        : props.cancelledCount > 0
          ? t('modelTest.progress.cancelled')
          : t('modelTest.progress.done')
  return (
    <div className="mx-4 mt-3 rounded-lg border border-module-border px-3 py-2.5">
      <div className="flex items-center justify-between gap-4 system-2xs-regular">
        <div className="flex min-w-0 items-center gap-3">
          <span className={cn('truncate system-2xs-medium', props.running ? 'text-text-primary' : 'text-text-secondary')}>{status}</span>
          <span className="shrink-0 text-text-success">{t('modelTest.progress.success', { count: props.successCount })}</span>
          <span className={cn('shrink-0', props.failureCount > 0 ? 'text-text-destructive' : 'text-text-tertiary')}>{t('modelTest.progress.failure', { count: props.failureCount })}</span>
          <span className={cn('shrink-0', props.cancelledCount > 0 ? 'text-text-tertiary' : 'text-text-quaternary')}>{t('modelTest.progress.cancelledCount', { count: props.cancelledCount })}</span>
        </div>
        <span className="shrink-0 font-mono tabular-nums text-text-tertiary">{props.completedCount}/{props.totalCount} · {props.progress}%</span>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-inset">
        <div className={cn('h-full transition-all duration-300', props.failureCount > 0 && !props.running ? 'bg-destructive' : 'bg-primary')} style={{ width: `${props.progress}%` }} />
      </div>
      <div className="mt-2 flex items-start gap-2 border-t border-border/50 pt-2 system-2xs-regular leading-4 text-text-warning">
        <TriangleAlert size={13} aria-hidden className="mt-px shrink-0" />
        <span className="min-w-0">{t('modelTest.costWarning')}</span>
      </div>
    </div>
  )
}

interface TaskCellProps {
  /** 格子的窄屏标签 key。表头管着 md 及以上，所以它只在这之下渲染。 */
  labelKey: UiCatalogKey
  /**
   * `'end'` 的格子右对齐并走等宽数字：这一列是拿来纵向比大小的。
   * 文字格（渠道 / 模型、状态）留 `'start'`，读的是内容本身。
   */
  align?: 'start' | 'end'
  children: React.ReactNode
}

/** 状态词的配色：成功绿、失败红、进行中主文色、取消与排队退到灰。 */
function statusTextClassName(status: TestTaskStatus): string {
  if (status === 'success') return 'text-text-success'
  if (status === 'failed') return 'text-text-destructive'
  if (status === 'running') return 'text-text-primary'
  if (status === 'cancelled') return 'text-text-tertiary'
  return 'text-text-quaternary'
}

/**
 * 状态格的 `title`：把「上游到底回了什么」补上。
 *
 * 格子里只印短短的「失败」，因为状态列要能一眼竖着扫下来；HTTP 码是查错时的第一手
 * 线索（401 与 429 的处置完全不同），所以它退到悬浮提示里，不占列宽。
 * 错误原文本来就在行下方那条红框里，不必在这里再抄一遍。
 */
function getTaskStatusTitle(task: TestTask, statusLabel: string): string {
  if (!task.result?.statusCode) return statusLabel
  return `${statusLabel} · HTTP ${task.result.statusCode}`
}

/**
 * 结果行里的一格数据。
 *
 * 窄屏堆叠时左边补一个标签：表头在 md 以下整条藏起来，`—` 与 `1.2k` 排成一串
 * 没有名字的读数时，读者只能靠第几行去猜哪个是耗时。md 及以上标签由表头统一说一次，
 * 这里就收起来，不在每行重复七遍（对比 `ClientRow` 的同一条理由）。
 */
function TaskCell(props: TaskCellProps) {
  const t = useTranslation()
  const numeric = props.align === 'end'
  return (
    <div className={cn('flex min-w-0 items-baseline justify-between gap-3 md:block', numeric && 'md:text-right')}>
      <span className="shrink-0 system-2xs-regular text-text-quaternary md:hidden">{t(props.labelKey)}</span>
      <div className={cn('min-w-0', numeric && 'font-mono system-2xs-regular tabular-nums text-text-tertiary')}>{props.children}</div>
    </div>
  )
}

/**
 * 一行结果的展开体：先给一句总账，再给逐轮。
 *
 * 为什么两段都要：多轮诊断的结论是「全部轮次都成功才算成功」，所以只看逐轮列表
 * 读不出「这个渠道到底算不算能用」；而只看成功率又不知道失败的那轮究竟回了什么。
 * 总账在上、逐轮在下，先回答「能不能用」，再回答「哪一轮、为什么」。
 *
 * 明细里不重复「渠道 / 模型 / 协议」——它们就在正上面那一行，重复一遍只是把
 * 一张小表拉长。
 */
function TaskDetail(props: TestTaskDetailProps) {
  const t = useTranslation()
  const rounds = getResultRounds(props.task.result!)
  const successCount = rounds.filter(round => round.success).length
  const successRate = Math.round((successCount / rounds.length) * 100)
  return (
    <div className="col-span-full rounded-lg border border-module-border">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border/50 px-2.5 py-2 system-2xs-regular">
        <span className="system-2xs-medium text-text-secondary">{t('modelTest.detail.summary')}</span>
        <span className="text-text-tertiary">
          {t('modelTest.detail.successRate')}{' '}
          <span className={cn('font-mono tabular-nums', successRate === 100 ? 'text-text-success' : 'text-text-destructive')}>
            {successCount}/{rounds.length} · {successRate}%
          </span>
        </span>
        <span className="text-text-tertiary">
          {t('modelTest.detail.protocol')}{' '}
          <span className={cn('inline-flex items-center gap-1', props.task.converted ? 'text-text-warning' : 'text-text-secondary')}>
            {props.task.converted && <Repeat size={9} aria-hidden />}
            {PROTOCOL_DISPLAY_NAMES[props.task.protocol]}
          </span>
        </span>
        <span className="text-text-tertiary">
          {t('modelTest.detail.duration')}{' '}
          <span className="font-mono tabular-nums text-text-secondary">{formatMilliseconds(props.task.result!.durationMilliseconds)}</span>
        </span>
      </div>

      <div className="divide-y divide-border/40">
        {rounds.map(round => (
          <div key={round.round} className="grid gap-1.5 px-2.5 py-2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 system-2xs-regular">
              <span className="shrink-0 font-mono tabular-nums text-text-quaternary">
                {t('modelTest.detail.round', { round: round.round })}
              </span>
              <span className={cn('shrink-0 system-2xs-medium', round.success ? 'text-text-success' : 'text-text-destructive')}>
                {t(TASK_STATUS_LABEL_KEYS[round.success ? 'success' : 'failed'])}
              </span>
              {round.statusCode && (
                <span className="shrink-0 text-text-tertiary">{t('modelTest.detail.httpStatus')} <span className="font-mono tabular-nums">{round.statusCode}</span></span>
              )}
              <span className="shrink-0 text-text-tertiary">
                {t('modelTest.detail.ttft')} <span className="font-mono tabular-nums">{formatMilliseconds(round.ttftMilliseconds)}</span>
              </span>
              <span className="shrink-0 text-text-tertiary">
                {t('modelTest.detail.duration')} <span className="font-mono tabular-nums">{formatMilliseconds(round.durationMilliseconds)}</span>
              </span>
              <span className="shrink-0 text-text-tertiary">
                {t('modelTest.detail.tps')} <span className="font-mono tabular-nums">{formatOutputSpeed(round.tokensPerSecond)}</span>
              </span>
              <span className="shrink-0 text-text-tertiary">
                {t('modelTest.detail.outputTokens')} <span className="font-mono tabular-nums">{formatTokenCount(round.outputTokens)}</span>
              </span>
            </div>
            {/* 失败那一轮的原话单独占一行：它通常很长（上游把整个 JSON 错误体回过来），
                挤在指标后面会把那一行撑成乱码一样的窄柱。成功轮不印这一行，避免「无错误」刷屏。 */}
            {!round.success && (
              <div className="wrap-break-word rounded-md border border-module-border bg-destructive/8 px-2 py-1.5 font-mono system-2xs-regular leading-4 text-text-destructive">
                {round.errorMessage || t('modelTest.detail.noError')}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * 一行诊断结论。
 *
 * 整行是一枚按钮（`aria-expanded`）：协议色条与标题都不可点，会让「这条能不能点开」
 * 变成靠猜——诊断结果是查错入口，必须一眼看出还能往下钻。
 * 展开按钮放在最左一列，与状态列分开，是因为状态列要能竖着扫；一行里出现两个交互
 * 形状时，扫视最先坏掉的就是那种「像按钮又不像按钮」的格子。
 */
function TestTaskRow(props: TestTaskRowProps) {
  const { task } = props
  const t = useTranslation()
  const statusLabel = t(TASK_STATUS_LABEL_KEYS[task.status])
  const expanded = props.expanded
  const ProtocolIcon = PROTOCOL_ICONS[task.protocol]
  return (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      aria-label={expanded ? t('modelTest.detail.collapse') : t('modelTest.detail.expand')}
      className={cn(
        tableRowClass,
        'grid cursor-pointer grid-cols-1 gap-2.5 px-3 py-2.5 md:items-start md:gap-3',
        expanded && 'bg-state-base-hover',
        TASK_GRID_COLUMNS,
      )}
      onClick={props.onToggleExpanded}
      onKeyDown={event => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        props.onToggleExpanded()
      }}
    >
      <div className="flex items-center md:pt-0.5">
        <ChevronRight size={13} aria-hidden className={cn('shrink-0 text-text-quaternary transition-transform', expanded && 'rotate-90')} />
      </div>
      {/* 渠道 / 模型一格定主体。 */}
      <div className="min-w-0">
        <div className="flex items-baseline gap-2 md:block">
          {/* 窄屏表头不在这里，所以标签跟着主体走；md 及以上由表头统一说一次。 */}
          <span className="shrink-0 system-2xs-regular text-text-quaternary md:hidden">{t('modelTest.table.target')}</span>
          <div className="min-w-0">
            <div className="truncate system-xs-medium text-text-primary">{task.providerName}</div>
            <div className="mt-0.5 truncate font-mono system-2xs-regular text-text-tertiary">{task.modelName}</div>
          </div>
        </div>
      </div>
      {/* 协议列：转换出来的协议走 warning 色 + `Repeat`，与左侧栏那条槽用的是同一套语义。 */}
      <TaskCell labelKey="modelTest.table.protocol">
        <span className={cn('inline-flex min-w-0 items-center gap-1 system-2xs-regular', task.converted ? 'text-text-warning' : 'text-text-secondary')}>
          {task.converted ? <Repeat size={9} aria-hidden className="shrink-0" /> : <ProtocolIcon size={11} aria-hidden className="shrink-0" />}
          <span className="truncate">{PROTOCOL_DISPLAY_NAMES[task.protocol]}</span>
        </span>
      </TaskCell>
      <TaskCell labelKey="modelTest.table.status">
        <span
          title={getTaskStatusTitle(task, statusLabel)}
          className={cn('inline-flex items-center gap-1 system-2xs-medium', statusTextClassName(task.status))}
        >
          {statusLabel}
        </span>
      </TaskCell>
      <TaskCell labelKey="modelTest.table.ttft" align="end">{getTaskTtftLabel(task)}</TaskCell>
      <TaskCell labelKey="modelTest.table.duration" align="end">{getTaskDurationLabel(task)}</TaskCell>
      <TaskCell labelKey="modelTest.table.speed" align="end">{getTaskSpeedLabel(task)}</TaskCell>
      <TaskCell labelKey="modelTest.table.tokens" align="end">{getTaskTokenLabel(task)}</TaskCell>
      {/* 明细只在点开时挂了，收起时不渲染：一张几十行的表里每行都藏一份明细，滚动会变卡。 */}
      {expanded && task.result && <TaskDetail task={task} />}
      {/* 没有 `result`（例如请求整批失败）时只有错误原文，此时没有逐轮可展开。 */}
      {!expanded && task.errorMessage && <div className="col-span-full wrap-break-word rounded-lg border border-module-border bg-destructive/8 px-2.5 py-2 font-mono system-2xs-regular leading-4 text-text-destructive">{task.errorMessage}</div>}
    </div>
  )
}

function EmptyTestTasks(props: EmptyTestTasksProps) {
  const t = useTranslation()
  return (
    <div className="flex min-h-52 flex-col items-center justify-center text-center">
      {/* 空状态只用一枚淡图标，不再给图标铺灰底方块——同一屏里的灰盒子越少越好。 */}
      <Cpu size={20} strokeWidth={1.5} aria-hidden className="mb-1.5 text-text-quaternary" />
      <div className="system-xs-medium text-text-primary">{props.hasEnabledModels ? t('modelTest.empty.noTasks') : t('modelTest.empty.noModels')}</div>
      <div className="mt-1.5 max-w-sm system-xs-regular leading-5 text-text-tertiary">
        {props.hasEnabledModels ? t('modelTest.empty.noTasksHint') : t('modelTest.empty.noModelsHint')}
      </div>
    </div>
  )
}

interface TestConfigPanelProps {
  config: TestConfig
  onChange: (config: TestConfig) => void
  onBack: () => void
  onReset: () => void
}

interface ConfigNumberRowProps {
  title: string
  description: string
  value: number
  min: number
  max: number
  /** 数值单位。数字后面那个词必须说出来，否则 `3` 是 3 个并发还是 3 轮全看读者猜。 */
  unitKey: UiCatalogKey
  onChange: (value: number) => void
}

/**
 * 一个数字设置项。右上角的 `—` / `+` 比裸输入框好用，也避免为了两个整数装一个滑块：
 * 并发与轮次的可用区间都很窄（1–10 / 1–5），调一格就是一次点击。
 */
function ConfigNumberRow(props: ConfigNumberRowProps) {
  const t = useTranslation()
  const clamp = (value: number) => Math.min(props.max, Math.max(props.min, Number.isFinite(value) ? Math.trunc(value) : props.min))
  return (
    <FormRow
      title={props.title}
      description={props.description}
      control={
        <>
          <Button
            variant="outline"
            size="icon-sm"
            disabled={props.value <= props.min}
            aria-label="-"
            onClick={() => props.onChange(clamp(props.value - 1))}
          >
            <span aria-hidden className="text-base leading-none">−</span>
          </Button>
          <input
            type="number"
            inputMode="numeric"
            min={props.min}
            max={props.max}
            value={props.value}
            aria-label={props.title}
            onChange={event => props.onChange(clamp(event.target.valueAsNumber))}
            className="h-7 w-12 rounded-md border border-border bg-components-input-bg-normal text-center font-mono system-2xs-regular tabular-nums text-text-primary outline-none focus-visible:border-primary"
          />
          <Button
            variant="outline"
            size="icon-sm"
            disabled={props.value >= props.max}
            aria-label="+"
            onClick={() => props.onChange(clamp(props.value + 1))}
          >
            <span aria-hidden className="text-base leading-none">+</span>
          </Button>
          <span className="w-10 shrink-0 system-2xs-regular text-text-quaternary">{t(props.unitKey)}</span>
        </>
      }
    />
  )
}

/**
 * 测试配置页。
 *
 * 它是同一层弹窗里的**另一页**，不是嵌套弹窗：诊断本身已经压着页面，再叠一层会让人
 * 在关闭路径上犯迷糊（关一次以为退了，其实只是退到上一层）。
 *
 * 每一项都是一条朴素横排（标题 + 说明在左、控件在右、`divide-y` 分隔），不套灰盒子、
 * 行内不放图标——设置页的视觉噪音每多一分，读者就越难判断「这一项开没开」。
 * 提示词是唯一例外：它要写长句，控件换到标题下方占满整行。
 */
function TestConfigPanel(props: TestConfigPanelProps) {
  const t = useTranslation()
  const { config } = props
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Button variant="ghost" size="icon-sm" title={t('modelTest.config.back')} aria-label={t('modelTest.config.back')} onClick={props.onBack}>
            <ArrowLeft size={14} aria-hidden />
          </Button>
          <div className="min-w-0">
            <div className="system-xs-medium text-text-primary">{t('modelTest.config.title')}</div>
            <div className="mt-0.5 truncate system-2xs-regular text-text-tertiary">{t('modelTest.config.description')}</div>
          </div>
        </div>
        <Button variant="ghost" size="xs" onClick={props.onReset}>
          <RotateCcw size={11} aria-hidden /> {t('modelTest.config.reset')}
        </Button>
      </div>

      <div className="divide-y divide-border/50 px-4">
        <ConfigNumberRow
          title={t('modelTest.config.concurrency')}
          description={t('modelTest.config.concurrencyHint')}
          value={config.concurrency}
          min={1}
          max={MAX_TEST_CONCURRENCY}
          unitKey="modelTest.metric.concurrency"
          onChange={concurrency => props.onChange({ ...config, concurrency })}
        />
        <ConfigNumberRow
          title={t('modelTest.config.rounds')}
          description={t('modelTest.config.roundsHint')}
          value={config.rounds}
          min={1}
          max={MAX_TEST_ROUNDS}
          unitKey="modelTest.config.unit.rounds"
          onChange={rounds => props.onChange({ ...config, rounds })}
        />
        <ConfigNumberRow
          title={t('modelTest.config.inputLength')}
          description={t('modelTest.config.inputLengthHint')}
          value={config.inputLength}
          min={0}
          max={MAX_TEST_PROMPT_LENGTH}
          unitKey="modelTest.config.unit.characters"
          onChange={inputLength => props.onChange({ ...config, inputLength })}
        />
        <div className="grid gap-1.5 py-3">
          <div className="system-sm-medium text-text-primary">{t('modelTest.config.prompt')}</div>
          <p className="system-xs-regular text-text-tertiary">{t('modelTest.config.promptHint')}</p>
          <Textarea
            value={config.prompt}
            maxLength={MAX_TEST_PROMPT_LENGTH}
            placeholder={t('modelTest.config.promptPlaceholder')}
            className="mt-1"
            onChange={event => props.onChange({ ...config, prompt: event.target.value })}
          />
          <span className="text-right font-mono system-2xs-regular tabular-nums text-text-quaternary">
            {config.prompt.length} / {MAX_TEST_PROMPT_LENGTH}
          </span>
        </div>
      </div>
    </div>
  )
}

export function ModelTestPanel(props: ModelTestPanelProps) {
  const t = useTranslation()
  const enabledModels = useMemo(() => props.models.filter(model => model.enabled), [props.models])
  const availableProviders = useMemo(
    () => props.providers.filter(provider => enabledModels.some(model => model.providerId === provider.id)),
    [enabledModels, props.providers],
  )
  const [selectedModelProtocols, setSelectedModelProtocols] = useState<Record<string, Set<Protocol>>>({})
  const [selectedProviderIds, setSelectedProviderIds] = useState<Set<string>>(new Set())
  const [tasks, setTasks] = useState<TestTask[]>([])
  const [failedOnly, setFailedOnly] = useState(false)
  /**
   * 右侧主体的两个视图。
   *
   * 配置做成「同一个弹窗里换一页」而不是第二个弹窗：诊断弹窗已经是叠在页面上的一层，
   * 再叠一层调用表，用户在关闭路径上会迷路。
   */
  const [view, setView] = useState<'results' | 'config'>('results')
  /**
   * 测试参数。用 state 而不是持久化存储：这是「这次怎么测」，不是一份要长期生效的偏好。
   * 关掉弹窗（或重开）就回到默认，下次诊断不会莫名其妙跑 5 轮。
   */
  const [config, setConfig] = useState<TestConfig>(DEFAULT_TEST_CONFIG)
  /** 展开的行。只存 id，收起时不渲染明细，几十行的表也不变卡。 */
  const [expandedTaskIds, setExpandedTaskIds] = useState<Set<string>>(new Set())
  /** 本轮诊断要问哪个问题。只影响「下一次开始」：已经有结论的行保留它自己跑的模式。 */
  const [testMode, setTestMode] = useState<ModelTestMode>('connectivity')
  const [running, setRunning] = useState(false)
  const previousOpen = useRef(false)
  const abortControllerRef = useRef<AbortController | null>(null)
  /**
   * `running` 是渲染状态，要等下一帧才变成 `true`：连点两下「开始诊断」时两个
   * 事件处理器看到的都还是 `false`，会同时打两批真实请求（真的花钱）。
   * 用 ref 做同步闸门，并把定时器 / 网络请求都挂在同一批身上。
   */
  const runningRef = useRef(false)

  // 面板被卸载（切换页面）时掐掉在跑的那批诊断，避免用户已经离开还在持续计费。
  useEffect(() => () => abortControllerRef.current?.abort(), [])

  /**
   * 模型 / 供应商集合变化后校正选中态。
   *
   * 三个 updater 都遵守同一条规矩：**没有实际变化就返回 `current`**。
   * 否则这里每次都返回新对象 / 新 Set / 新数组，而 `enabledModels`、`availableProviders`
   * 又会随父级重渲染（供应商轮询每 10s、模型轮询每 30s）而重建，
   * 于是「重渲染 → 重跑 effect → 写新 state → 再重渲染」会一直空转。
   */
  useEffect(() => {
    const isOpening = props.open && !previousOpen.current
    previousOpen.current = props.open
    if (!props.open) return

    setSelectedModelProtocols(current => {
      if (isOpening) return Object.keys(current).length === 0 ? current : {}
      let changed = false
      const next: Record<string, Set<Protocol>> = {}
      for (const model of enabledModels) {
        const kept = new Set([...(current[model.id] ?? [])].filter(protocol => getTestableProtocols(model).includes(protocol)))
        const previous = current[model.id]
        // `kept` 是 `previous` 的子集，长度相同就意味着一个都没被剔掉，可以沿用原 Set 引用。
        if (previous && previous.size === kept.size) next[model.id] = previous
        else {
          next[model.id] = kept
          changed = true
        }
      }
      if (Object.keys(next).length !== Object.keys(current).length) changed = true
      return changed ? next : current
    })
    setSelectedProviderIds(current => {
      if (isOpening) return current.size === 0 ? current : new Set()
      const next = new Set([...current].filter(providerId => availableProviders.some(provider => provider.id === providerId)))
      return next.size === current.size ? current : next
    })
    if (isOpening) {
      setTasks(current => (current.length === 0 ? current : []))
      setFailedOnly(false)
      // 展开态跟着结果走：重开面板时表是空的，残留的展开 id 只会在下一批结果里随机命中。
      setExpandedTaskIds(current => (current.size === 0 ? current : new Set()))
      setView('results')
      setConfig(current => (current === DEFAULT_TEST_CONFIG ? current : DEFAULT_TEST_CONFIG))
      // 每次重新打开都从默认模式开始：上次点到「速度诊断」后关掉面板，
      // 下次再进来时应该看到默认的连通性诊断，而不是一个没被注意到的长提示词诊断。
      setTestMode('connectivity')
      setRunning(false)
    }
  }, [props.open, enabledModels, availableProviders])

  const plannedTasks = useMemo<TestTask[]>(() => enabledModels.flatMap(model => {
    if (!selectedProviderIds.has(model.providerId)) return []
    const provider = props.providers.find(item => item.id === model.providerId)
    if (!provider) return []
    const selectedProtocols = selectedModelProtocols[model.id] ?? new Set(getTestableProtocols(model))
    return getTestableProtocols(model).filter(protocol => selectedProtocols.has(protocol)).map(protocol => ({
      id: `${model.id}:${protocol}`,
      modelId: model.id,
      modelName: model.modelName,
      providerId: provider.id,
      providerName: provider.name,
      protocol,
      converted: supportsConvertedProtocol(model, protocol),
      status: 'queued' as const,
    }))
  }), [enabledModels, props.providers, selectedModelProtocols, selectedProviderIds])

  const hasResults = tasks.length > 0
  /** 没有可测目标时「开始诊断」与右侧的模式箭头一起变灰：它是同一个控件的两半。 */
  const startDisabled = plannedTasks.length === 0
  const successCount = tasks.filter(task => task.status === 'success').length
  const failureCount = tasks.filter(task => task.status === 'failed').length
  const cancelledCount = tasks.filter(task => task.status === 'cancelled').length
  const completedCount = successCount + failureCount + cancelledCount
  const progress = tasks.length === 0 ? 0 : Math.round((completedCount / tasks.length) * 100)
  /**
   * 重测成功后失败数会归零，此时不能再停留在「只看失败」上——否则表格会空白，
   * 而失败行其实已经变绿了。所以筛选生效与否是推导出来的，不写回 state。
   */
  const showFailedOnly = failedOnly && failureCount > 0
  const visibleTasks = hasResults
    ? showFailedOnly ? tasks.filter(task => task.status === 'failed') : tasks
    : plannedTasks
  const visibleTotal = hasResults ? tasks.length : plannedTasks.length

  const clearTasks = () => {
    setTasks([])
    setFailedOnly(false)
    setExpandedTaskIds(current => (current.size === 0 ? current : new Set()))
  }

  const toggleTaskExpanded = (taskId: string) => {
    setExpandedTaskIds(current => {
      const next = new Set(current)
      if (next.has(taskId)) next.delete(taskId)
      else next.add(taskId)
      return next
    })
  }
  const toggleModelProtocol = (modelId: string, protocol: Protocol) => {
    if (running) return
    setSelectedModelProtocols(current => {
      const next = { ...current }
      /*
       * 起点必须是**行上显示的那个默认**（全部可测协议），不能是空集。
       * 面板刚打开时没有任何显式选择，而模型行已经把三个分段都画成选中、右侧也写着
       * `3/3 协议`；此时从空集开始就差一个，第一下点击会静默地把另外两个一起取消——
       * 显示与实际各说一套。没存过就从默认推导一遍，两处永远同源。
       */
      const model = enabledModels.find(item => item.id === modelId)
      const selectedProtocols = new Set(current[modelId] ?? (model ? getTestableProtocols(model) : []))
      if (selectedProtocols.has(protocol)) selectedProtocols.delete(protocol)
      else selectedProtocols.add(protocol)
      next[modelId] = selectedProtocols
      return next
    })
    clearTasks()
  }

  const toggleProvider = (providerId: string) => {
    if (running) return
    setSelectedProviderIds(current => {
      const next = new Set(current)
      if (next.has(providerId)) next.delete(providerId)
      else next.add(providerId)
      return next
    })
    clearTasks()
  }

  /**
   * 一次开关一个模型的全部可测协议。
   *
   * 满选 / 部分选都归到同一个动作上：满选就清空、其余情况补满——半选时用户的本意
   * 基本都是「我要这个模型的全部」，而不是「再点一下变成空的」。
   * 模型走的是 `enabledModels` 而不是某个视图，所以搜索词不影响它勾到几个协议。
   */
  const toggleModel = (modelId: string) => {
    if (running) return
    const model = enabledModels.find(item => item.id === modelId)
    if (!model) return
    const protocols = getTestableProtocols(model)
    setSelectedModelProtocols(current => {
      const selectedProtocols = current[modelId] ?? new Set(protocols)
      const fullySelected = protocols.length > 0 && protocols.every(protocol => selectedProtocols.has(protocol))
      return { ...current, [modelId]: new Set(fullySelected ? [] : protocols) }
    })
    clearTasks()
  }

  const allTasksSelected = enabledModels.length > 0
    && enabledModels.every(model => selectedProviderIds.has(model.providerId)
      && getTestableProtocols(model).every(protocol => selectedModelProtocols[model.id]?.has(protocol)))

  const toggleAll = () => {
    if (running) return
    if (allTasksSelected) {
      setSelectedProviderIds(new Set())
      setSelectedModelProtocols(Object.fromEntries(enabledModels.map(model => [model.id, new Set<Protocol>()])))
    } else {
      setSelectedProviderIds(new Set(availableProviders.map(provider => provider.id)))
      setSelectedModelProtocols(Object.fromEntries(
        enabledModels.map(model => [model.id, new Set(getTestableProtocols(model))]),
      ))
    }
    clearTasks()
  }

  /**
   * 跑一批诊断任务。
   *
   * - `runningRef` 做同步闸门：诊断会真的请求上游并计费，任何时候都只允许一批在跑。
   * - 任务按 id 合并进结果表：整批开跑时表里通常是空的，重测时其它行的结论原样保留。
   * - 并发只在这里控制（`config.concurrency` 个 worker），服务端一次请求只测一个目标。
   */
  const runTasks = async (batch: TestTask[]) => {
    if (runningRef.current || batch.length === 0) return
    const pending = batch.map(task => ({ ...task, status: 'queued' as const, result: undefined, errorMessage: undefined }))
    const controller = new AbortController()
    runningRef.current = true
    abortControllerRef.current = controller
    setRunning(true)
    setTasks(current => {
      if (current.length === 0) return pending
      const byId = new Map(pending.map(task => [task.id, task]))
      return current.map(task => byId.get(task.id) ?? task)
    })
    let nextIndex = 0

    const worker = async () => {
      while (!controller.signal.aborted && nextIndex < pending.length) {
        const task = pending[nextIndex++]
        setTasks(current => current.map(item => item.id === task.id ? { ...item, status: 'running' } : item))
        try {
          const response = await modelTestApi.run(task.protocol, testMode, {
            providerIds: [task.providerId],
            modelIds: [task.modelId],
          }, {
            rounds: config.rounds,
            // 空提示词不发：不发与服务端会回退到该模式的默认提示词，两边口径一致。
            prompt: config.prompt.trim() || undefined,
            inputLength: config.inputLength,
          }, controller.signal)
          if (controller.signal.aborted) break
          const result = response.success
            ? response.data.results.find(item => item.modelId === task.modelId)
            : undefined
          const succeeded = Boolean(result?.success)
          setTasks(current => current.map(item => item.id === task.id ? {
            ...item,
            status: succeeded ? 'success' : 'failed',
            result,
            errorMessage: response.success
              ? result ? result.errorMessage : t('modelTest.error.missingEndpoint')
              : response.errorMessage,
          } : item))
        } catch (error) {
          if (controller.signal.aborted) break
          setTasks(current => current.map(item => item.id === task.id ? {
            ...item,
            status: 'failed',
            errorMessage: error instanceof Error ? error.message : t('modelTest.error.requestFailed'),
          } : item))
        }
      }
    }

    try {
      await Promise.all(Array.from({ length: Math.min(config.concurrency, pending.length) }, () => worker()))
    } finally {
      if (controller.signal.aborted) {
        setTasks(current => current.map(task => task.status === 'queued' || task.status === 'running'
          ? { ...task, status: 'cancelled', errorMessage: undefined }
          : task))
      }
      if (abortControllerRef.current === controller) abortControllerRef.current = null
      runningRef.current = false
      setRunning(false)
    }
  }

  const startTests = () => {
    setFailedOnly(false)
    void runTasks(plannedTasks)
  }

  /** 重测不重新规划：直接拿表里失败的那几行重跑，结果就地刷新，其它行不动。 */
  const retryFailedTests = () => {
    void runTasks(tasks.filter(task => task.status === 'failed'))
  }

  const cancelTests = () => abortControllerRef.current?.abort()

  return (
    <Dialog open={props.open} onOpenChange={open => !running && props.onOpenChange(open)}>
      <DialogContent className="flex h-[min(780px,92vh)] w-[calc(100%-1rem)] max-w-6xl flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl">
        <DialogHeader className="bg-popover px-5 py-4 pr-14">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><FlaskConical size={15} aria-hidden /></div>
            <div className="min-w-0">
              <DialogTitle>{t('modelTest.title')}</DialogTitle>
              <DialogDescription className="mt-1 system-xs-regular text-text-tertiary">{t('modelTest.description')}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[340px_minmax(0,1fr)] lg:overflow-hidden">
          <ModelSelection
            allTasksSelected={allTasksSelected}
            availableProviders={availableProviders}
            enabledModels={enabledModels}
            running={running}
            selectedModelProtocols={selectedModelProtocols}
            selectedProviderIds={selectedProviderIds}
            onToggleAll={toggleAll}
            onToggleModel={toggleModel}
            onToggleModelProtocol={toggleModelProtocol}
            onToggleProvider={toggleProvider}
          />

          <div className="flex min-h-0 flex-col bg-card">
            {view === 'config' ? (
              <TestConfigPanel
                config={config}
                onChange={setConfig}
                onBack={() => setView('results')}
                onReset={() => setConfig(DEFAULT_TEST_CONFIG)}
              />
            ) : (
              <>
                <div className="px-4 pt-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-4">
                      <div className="flex items-center gap-2">
                        <Gauge size={14} aria-hidden className="text-text-quaternary" />
                        <div>
                          <div className="font-mono text-base font-medium tabular-nums leading-none text-text-primary">{plannedTasks.length}</div>
                          <div className="mt-1 system-2xs-regular text-text-tertiary">{t('modelTest.metric.tasks')}</div>
                        </div>
                      </div>
                      <div className="h-7 w-px bg-border" />
                      <div>
                        <div className="font-mono text-base font-medium tabular-nums leading-none text-text-primary">{selectedProviderIds.size}</div>
                        <div className="mt-1 system-2xs-regular text-text-tertiary">{t('modelTest.metric.channels')}</div>
                      </div>
                      <div className="h-7 w-px bg-border" />
                      <div>
                        <div className="font-mono text-base font-medium tabular-nums leading-none text-text-primary">{config.concurrency}</div>
                        <div className="mt-1 system-2xs-regular text-text-tertiary">{t('modelTest.metric.concurrency')}</div>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {hasResults && !running && (
                        <Button variant="ghost" size="icon-sm" title={t('modelTest.action.clearResults')} aria-label={t('modelTest.action.clearResults')} onClick={clearTasks}>
                          <Trash2 size={13} />
                        </Button>
                      )}
                      {failureCount > 0 && !running && (
                        <Button variant="outline" size="sm" onClick={retryFailedTests}>
                          <RotateCcw size={12} /> {t('modelTest.action.retryFailed')}
                        </Button>
                      )}
                      {running ? (
                        <Button variant="destructive" size="sm" onClick={cancelTests}>
                          <Square size={11} fill="currentColor" /> {t('modelTest.action.stop')}
                        </Button>
                      ) : (
                        <>
                          {/*
                            设置按钮放在开始按钮**左边**：它是「开始之前先想一下」的前置动作，
                            不是开始之后的补丁。不塞进分裂按钮里——那会把「参数」说成「模式」的一部分。
                          */}
                          <Button
                            variant="outline"
                            size="icon-sm"
                            title={t('modelTest.action.settings')}
                            aria-label={t('modelTest.action.settings')}
                            onClick={() => setView('config')}
                          >
                            <Settings2 size={13} aria-hidden />
                          </Button>
                          {/*
                            分裂按钮：左半是「用当前模式开始」，右半那枚箭头展开模式本身。
                            箭头紧贴在开始按钮右侧、与之同色同高，读起来是一个控件；
                            单独拿出一枚圆角按钮会把「选模式」说成另一件事。
                          */}
                          <ButtonGroup>
                            <Button size="sm" disabled={startDisabled} onClick={startTests}>
                              <Play size={12} fill="currentColor" /> {t('modelTest.action.start')}
                            </Button>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  size="icon-sm"
                                  disabled={startDisabled}
                                  aria-label={t('modelTest.mode.select', { mode: t(TEST_MODE_LABEL_KEYS[testMode]) })}
                                  title={t('modelTest.mode.select', { mode: t(TEST_MODE_LABEL_KEYS[testMode]) })}
                                >
                                  <ChevronDown size={13} aria-hidden />
                                </Button>
                              </DropdownMenuTrigger>
                              {/* 浮层改成固定宽度：默认宽度跟随触发器（一枚 28px 的方块），两行文案会被挤成一列。 */}
                              <DropdownMenuContent align="end" sideOffset={6} className="w-72 min-w-72">
                                <DropdownMenuLabel>{t('modelTest.mode.label')}</DropdownMenuLabel>
                                <DropdownMenuSeparator className="bg-components-panel-border" />
                                <DropdownMenuRadioGroup
                                  value={testMode}
                                  onValueChange={value => {
                                    const next = ALL_MODEL_TEST_MODES.find(mode => mode === value)
                                    if (next) setTestMode(next)
                                  }}
                                >
                                  {ALL_MODEL_TEST_MODES.map(mode => (
                                    <DropdownMenuRadioItem
                                      key={mode}
                                      value={mode}
                                      className="flex h-auto flex-col items-stretch gap-0.5 rounded-lg py-1.5 pl-2"
                                    >
                                      <span className="system-xs-medium text-text-primary">{t(TEST_MODE_LABEL_KEYS[mode])}</span>
                                      <span className="system-2xs-regular leading-4 text-text-tertiary">{t(TEST_MODE_HINT_KEYS[mode])}</span>
                                    </DropdownMenuRadioItem>
                                  ))}
                                </DropdownMenuRadioGroup>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </ButtonGroup>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <TestProgress
                  cancelledCount={cancelledCount}
                  completedCount={completedCount}
                  failureCount={failureCount}
                  progress={progress}
                  running={running}
                  successCount={successCount}
                  totalCount={visibleTotal}
                />

                <main className="min-h-0 flex-1 overflow-auto p-4">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <Button variant={showFailedOnly ? 'ghost' : 'secondary'} size="xs" onClick={() => setFailedOnly(false)}>{t('modelTest.filter.all')}</Button>
                      <Button variant={showFailedOnly ? 'secondary' : 'ghost'} size="xs" disabled={!hasResults || failureCount === 0} onClick={() => setFailedOnly(true)}>
                        {failureCount > 0 ? `${t('modelTest.filter.failed')} · ${failureCount}` : t('modelTest.filter.failed')}
                      </Button>
                    </div>
                    <span className="font-mono system-2xs-regular tabular-nums text-text-quaternary">{visibleTasks.length} / {visibleTotal}</span>
                  </div>
                  {visibleTasks.length > 0 ? (
                    <TableFrame>
                      {/* 表头第一格空着：下面是展开箭头，给它一个 `aria-label` 就够，不需要列名。 */}
                      <TableHeaderSurface className={cn('hidden gap-3 px-3 py-2 md:grid', TASK_GRID_COLUMNS)}>
                        <span aria-hidden />
                        <span>{t('modelTest.table.target')}</span>
                        <span>{t('modelTest.table.protocol')}</span>
                        <span>{t('modelTest.table.status')}</span>
                        <span className="text-right">{t('modelTest.table.ttft')}</span>
                        <span className="text-right">{t('modelTest.table.duration')}</span>
                        <span className="text-right">{t('modelTest.table.speed')}</span>
                        <span className="text-right">{t('modelTest.table.tokens')}</span>
                      </TableHeaderSurface>
                      {visibleTasks.map(task => (
                        <TestTaskRow
                          key={task.id}
                          task={task}
                          expanded={expandedTaskIds.has(task.id)}
                          onToggleExpanded={() => toggleTaskExpanded(task.id)}
                        />
                      ))}
                    </TableFrame>
                  ) : (
                    <EmptyTestTasks hasEnabledModels={enabledModels.length > 0} />
                  )}
                </main>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
