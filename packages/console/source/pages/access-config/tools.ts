import type { UiCatalogKey } from '@common/i18n/catalogs'

/**
 * 接入配置页的数据源：用户拿哪个工具来接，以及那个工具该怎么写。
 *
 * 这一页的视角是「把我们的服务配进**你自己的**工具里」——所以答案取决于用户手里是哪个工具，
 * 而不是取决于我们提供哪些协议。协议只是被工具决定的后果：选了 Claude Code，地址就该停在端口；
 * 选了 Cursor，地址就该带 `/v1`。把这些「工具 → 写法」的对应关系写成数据而不是散在 JSX 里，
 * 是为了让新增一个工具只改这一处，也让 test 能在没有 DOM 的情况下把地址语义钉住。
 */

/**
 * 工具会说哪种协议。
 *
 * 它唯一的作用是决定 Base URL 要不要带 `/v1`，以及卡片头的徽标——这正是这一页最贵的那个错误：
 * 两类工具的 Base URL 只差一个 `/v1`，而它们各自会补自己的接口路径（见 `buildBaseUrl`）。
 */
export type AccessProtocol = 'openai' | 'anthropic'

/** 左栏的分组。只影响列表里的小标题，不影响排序。 */
export type AccessToolGroupId = 'agents' | 'sdk'

export type AccessToolId =
  | 'claudeCode'
  | 'codexCli'
  | 'cursor'
  | 'cline'
  | 'openaiSdk'
  | 'anthropicSdk'

/** 左栏分组顺序。 */
export const ACCESS_TOOL_GROUPS: AccessToolGroupId[] = ['agents', 'sdk']

/** 左栏默认选中的工具；排在第一组的第一个，也就是「最可能来这一页的人」。 */
export const DEFAULT_ACCESS_TOOL_ID: AccessToolId = 'claudeCode'

/** 片段与步骤里能引用到的值，全部由服务根地址派生，或者是进不了文案表的样例常量。 */
export interface AccessToolValues {
  /** 服务根地址，形如 `http://127.0.0.1:19300`；拼不出来时是空串。 */
  origin: string
  /** 该工具 Base URL 输入框里要填的那一条。 */
  baseUrl: string
  apiKey: string
  model: string
}

/** 代码块的语种，只用于给它挑语义标签；这里不做语法高亮。 */
export type AccessSnippetLanguage = 'shell' | 'toml' | 'python'

export interface AccessSnippet {
  language: AccessSnippetLanguage
  /**
   * 渲染成可整段粘贴的文本。
   *
   * 根地址还没拼出来（服务没跑、端口没读到）时返回空串，由调用方换成占位符并禁用复制——
   * 一个带空地址的片段粘出去只会更糟。
   */
  render: (values: AccessToolValues) => string
}

/** 图形界面类工具没有配置文件可写，能给的是一条条「在哪个框里填什么」。 */
export interface AccessSetupStep {
  /** 这一步要做什么。 */
  labelKey: UiCatalogKey
  /** 这一步要填的值；给了就渲染成等宽文本 + 就地复制。 */
  value?: (values: AccessToolValues) => string
  /** 值旁边那个复制按钮的无障碍名；和 `value` 成对出现，缺一个会在 test 里被拦下。 */
  copyLabelKey?: UiCatalogKey
}

/** 一个工具「写进这里」那一节的内容形态：要么贴一份配置，要么照着四个框填。 */
export type AccessToolSetup =
  | { kind: 'snippet'; snippet: AccessSnippet }
  | { kind: 'steps'; steps: AccessSetupStep[] }

export interface AccessTool {
  id: AccessToolId
  group: AccessToolGroupId
  /** 产品名，专有名词，不进文案表。 */
  name: string
  protocol: AccessProtocol
  /** 一句话说清这个工具怎么接，进卡片头。 */
  descriptionKey: UiCatalogKey
  /** 值写进哪里；本身就是「位置」，所以不做本地化之外的加工。 */
  locationKey: UiCatalogKey
  setup: AccessToolSetup
  /** 配置本身之外还要交代的一句。 */
  noteKey: UiCatalogKey
}

/**
 * 本地服务不校验鉴权（见 `docs/product/security-privacy.md`），Key 只要非空。
 * 给一个固定样例，用户不用为了凑一个值先跑去别处。
 */
export const SAMPLE_API_KEY = 'sk-one-switch'

/**
 * 内建兜底逻辑模型的名字：模型名命中不了任何逻辑模型时，请求会落到它上面。
 * 所以它同时是「先随便填一个」的样例值，也是验证命令里那个模型名。
 */
export const SAMPLE_MODEL_NAME = 'default'

/** 协议徽标上的字。它和 `AccessProtocol` 一一对应，加协议时编译器会提醒这里也要加。 */
export const PROTOCOL_LABEL_KEYS: Record<AccessProtocol, UiCatalogKey> = {
  openai: 'access.protocol.openai',
  anthropic: 'access.protocol.anthropic',
}

/**
 * 每个协议「它会自己补哪段路径」的说明——抄地址之前必须先读这一句，
 * 因为这一步最贵的错误就是多带或少带那个 `/v1`。
 */
export const PROTOCOL_HINT_KEYS: Record<AccessProtocol, UiCatalogKey> = {
  openai: 'access.address.openaiHint',
  anthropic: 'access.address.anthropicHint',
}

/** 左栏分组的小标题。 */
export const TOOL_GROUP_TITLE_KEYS: Record<AccessToolGroupId, UiCatalogKey> = {
  agents: 'access.group.agents',
  sdk: 'access.group.sdk',
}

const OPENAI_BASE_PATH = '/v1'

/**
 * 要填进客户端 Base URL 输入框的那一条，只由协议决定。
 *
 * OpenAI 系工具只拼 `/chat/completions`、`/responses`、`/models`，所以 `/v1` 必须由这条地址带上；
 * Anthropic 系工具会自己补 `/v1/messages`，这条地址就得停在端口——
 * 在这里多写一个 `/v1`，每次调用都会打到 `/v1/v1/messages` 上，而这在客户端里只表现为一个 404。
 */
export function buildBaseUrl(origin: string, protocol: AccessProtocol): string {
  if (!origin) return ''
  return protocol === 'openai' ? `${origin}${OPENAI_BASE_PATH}` : origin
}

/** 把一个工具需要的三样值都算出来，交给片段渲染函数。 */
export function resolveToolValues(tool: AccessTool, origin: string): AccessToolValues {
  return {
    origin,
    baseUrl: buildBaseUrl(origin, tool.protocol),
    apiKey: SAMPLE_API_KEY,
    model: SAMPLE_MODEL_NAME,
  }
}

/**
 * 验证命令：按协议分叉，而不是按工具分叉——同一协议下所有工具打的是同一条路径，
 * 所以六个工具只需要两条命令，多出来的分叉只会成为撒谎的地方。
 *
 * 它打的是**转发路径**（`/v1/messages`、`/v1/chat/completions`），故意不用 `/v1/models`：
 * 后者是本地的模型列表接口，它通了也证明不了转发链路通。
 */
export function buildVerifyCommand(origin: string, protocol: AccessProtocol): string {
  if (!origin) return ''
  if (protocol === 'anthropic') {
    return [
      `curl -s ${origin}/v1/messages \\`,
      `  -H 'x-api-key: ${SAMPLE_API_KEY}' \\`,
      `  -H 'anthropic-version: 2023-06-01' \\`,
      `  -H 'Content-Type: application/json' \\`,
      `  -d '{"model":"${SAMPLE_MODEL_NAME}","max_tokens":64,"messages":[{"role":"user","content":"hi"}]}'`,
    ].join('\n')
  }
  return [
    `curl -s ${origin}/v1/chat/completions \\`,
    `  -H 'Authorization: Bearer ${SAMPLE_API_KEY}' \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -d '{"model":"${SAMPLE_MODEL_NAME}","messages":[{"role":"user","content":"hi"}]}'`,
  ].join('\n')
}

/**
 * 六个工具，按「用户手上有什么」分组。
 *
 * 首批只收这些：命令行 / 编辑器插件 / SDK 各有一两个代表，覆盖两类协议。
 * 每加一个都要能给出**真的不一样**的写法，否则列表就退化成一排同款卡片。
 */
export const ACCESS_TOOLS: AccessTool[] = [
  {
    id: 'claudeCode',
    group: 'agents',
    name: 'Claude Code',
    protocol: 'anthropic',
    descriptionKey: 'access.tool.claudeCode.description',
    locationKey: 'access.tool.claudeCode.location',
    noteKey: 'access.tool.claudeCode.note',
    setup: {
      kind: 'snippet',
      snippet: {
        language: 'shell',
        render: values => (values.origin
          ? [
              `export ANTHROPIC_BASE_URL=${values.baseUrl}`,
              `export ANTHROPIC_AUTH_TOKEN=${values.apiKey}`,
              `export ANTHROPIC_MODEL=${values.model}`,
            ].join('\n')
          : ''),
      },
    },
  },
  {
    id: 'codexCli',
    group: 'agents',
    name: 'Codex CLI',
    protocol: 'openai',
    descriptionKey: 'access.tool.codexCli.description',
    locationKey: 'access.tool.codexCli.location',
    noteKey: 'access.tool.codexCli.note',
    setup: {
      kind: 'snippet',
      snippet: {
        language: 'toml',
        render: values => (values.origin
          ? [
              `model = "${values.model}"`,
              'model_provider = "one-switch"',
              '',
              '[model_providers.one-switch]',
              'name = "One Switch"',
              `base_url = "${values.baseUrl}"`,
              'env_key = "ONE_SWITCH_API_KEY"',
            ].join('\n')
          : ''),
      },
    },
  },
  {
    id: 'cursor',
    group: 'agents',
    name: 'Cursor',
    protocol: 'openai',
    descriptionKey: 'access.tool.cursor.description',
    locationKey: 'access.tool.cursor.location',
    noteKey: 'access.tool.cursor.note',
    setup: {
      kind: 'steps',
      steps: [
        { labelKey: 'access.tool.cursor.step.openKey' },
        { labelKey: 'access.tool.cursor.step.baseUrl' },
        {
          labelKey: 'access.tool.cursor.step.apiKey',
          value: values => values.apiKey,
          copyLabelKey: 'access.field.apiKey.copy',
        },
        {
          labelKey: 'access.tool.cursor.step.model',
          value: values => values.model,
          copyLabelKey: 'access.field.model.copy',
        },
      ],
    },
  },
  {
    id: 'cline',
    group: 'agents',
    name: 'Cline',
    protocol: 'openai',
    descriptionKey: 'access.tool.cline.description',
    locationKey: 'access.tool.cline.location',
    noteKey: 'access.tool.cline.note',
    setup: {
      kind: 'steps',
      steps: [
        { labelKey: 'access.tool.cline.step.provider' },
        { labelKey: 'access.tool.cline.step.baseUrl' },
        {
          labelKey: 'access.tool.cline.step.apiKey',
          value: values => values.apiKey,
          copyLabelKey: 'access.field.apiKey.copy',
        },
        {
          labelKey: 'access.tool.cline.step.model',
          value: values => values.model,
          copyLabelKey: 'access.field.model.copy',
        },
      ],
    },
  },
  {
    id: 'openaiSdk',
    group: 'sdk',
    name: 'OpenAI SDK',
    protocol: 'openai',
    descriptionKey: 'access.tool.openaiSdk.description',
    locationKey: 'access.tool.openaiSdk.location',
    noteKey: 'access.tool.openaiSdk.note',
    setup: {
      kind: 'snippet',
      snippet: {
        language: 'python',
        render: values => (values.origin
          ? [
              'from openai import OpenAI',
              '',
              'client = OpenAI(',
              `    base_url="${values.baseUrl}",`,
              `    api_key="${values.apiKey}",`,
              ')',
            ].join('\n')
          : ''),
      },
    },
  },
  {
    id: 'anthropicSdk',
    group: 'sdk',
    name: 'Anthropic SDK',
    protocol: 'anthropic',
    descriptionKey: 'access.tool.anthropicSdk.description',
    locationKey: 'access.tool.anthropicSdk.location',
    noteKey: 'access.tool.anthropicSdk.note',
    setup: {
      kind: 'snippet',
      snippet: {
        language: 'python',
        render: values => (values.origin
          ? [
              'from anthropic import Anthropic',
              '',
              'client = Anthropic(',
              `    base_url="${values.baseUrl}",`,
              `    api_key="${values.apiKey}",`,
              ')',
            ].join('\n')
          : ''),
      },
    },
  },
]

export function findAccessTool(id: AccessToolId): AccessTool {
  const tool = ACCESS_TOOLS.find(candidate => candidate.id === id)
  // id 是联合类型，找不到只可能是数据表被改坏了；此时宁可炸在开发期。
  if (!tool) throw new Error(`unknown access tool: ${id}`)
  return tool
}
