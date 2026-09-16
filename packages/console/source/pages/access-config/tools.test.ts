import { describe, expect, it } from 'vitest'
import {
  ACCESS_TOOL_GROUPS,
  ACCESS_TOOLS,
  DEFAULT_ACCESS_TOOL_ID,
  SAMPLE_API_KEY,
  SAMPLE_MODEL_NAME,
  buildBaseUrl,
  buildVerifyCommand,
  findAccessTool,
  resolveToolValues,
} from './tools'

const ORIGIN = 'http://127.0.0.1:19300'

describe('工具表', () => {
  it('分组都非空，且工具 id 唯一', () => {
    for (const group of ACCESS_TOOL_GROUPS) {
      expect(ACCESS_TOOLS.filter(tool => tool.group === group).length).toBeGreaterThan(0)
    }
    expect(new Set(ACCESS_TOOLS.map(tool => tool.id)).size).toBe(ACCESS_TOOLS.length)
  })

  it('默认选中的工具就在表里', () => {
    expect(ACCESS_TOOLS.some(tool => tool.id === DEFAULT_ACCESS_TOOL_ID)).toBe(true)
  })

  it('两类协议各至少有一个工具，否则徽标和提示等于死代码', () => {
    const protocols = new Set(ACCESS_TOOLS.map(tool => tool.protocol))
    expect([...protocols].sort()).toEqual(['anthropic', 'openai'])
  })
})

describe('Base URL', () => {
  it('OpenAI 系带 /v1，Anthropic 系停在端口', () => {
    expect(buildBaseUrl(ORIGIN, 'openai')).toBe(`${ORIGIN}/v1`)
    expect(buildBaseUrl(ORIGIN, 'anthropic')).toBe(ORIGIN)
  })

  it('任何工具的 Base URL 都不会出现 /v1/v1', () => {
    for (const tool of ACCESS_TOOLS) {
      expect(buildBaseUrl(ORIGIN, tool.protocol)).not.toContain('/v1/v1')
    }
  })

  it('同一协议的工具拿到的是同一条地址', () => {
    const openai = new Set(ACCESS_TOOLS.filter(tool => tool.protocol === 'openai').map(tool => buildBaseUrl(ORIGIN, tool.protocol)))
    const anthropic = new Set(ACCESS_TOOLS.filter(tool => tool.protocol === 'anthropic').map(tool => buildBaseUrl(ORIGIN, tool.protocol)))
    expect(openai).toEqual(new Set([`${ORIGIN}/v1`]))
    expect(anthropic).toEqual(new Set([ORIGIN]))
  })

  it('根地址拼不出来时给空串，调用方据此显示占位符并禁用复制', () => {
    expect(buildBaseUrl('', 'openai')).toBe('')
    expect(buildBaseUrl('', 'anthropic')).toBe('')
  })
})

describe('片段与步骤', () => {
  it('步骤里「要填的值」和「复制按钮的名字」成对出现', () => {
    for (const tool of ACCESS_TOOLS) {
      if (tool.setup.kind !== 'steps') continue
      for (const step of tool.setup.steps) {
        expect(Boolean(step.value), `${tool.id} 的步骤 ${step.labelKey}`).toBe(Boolean(step.copyLabelKey))
      }
    }
  })

  it('根地址缺失时片段渲染成空串，而不是半截配置', () => {
    for (const tool of ACCESS_TOOLS) {
      if (tool.setup.kind !== 'snippet') continue
      expect(tool.setup.snippet.render(resolveToolValues(tool, '')), tool.id).toBe('')
    }
  })

  it('片段里都带着这条地址', () => {
    for (const tool of ACCESS_TOOLS) {
      if (tool.setup.kind !== 'snippet') continue
      const code = tool.setup.snippet.render(resolveToolValues(tool, ORIGIN))
      expect(code, tool.id).toContain(buildBaseUrl(ORIGIN, tool.protocol))
    }
  })

  it('片段都交代了鉴权：能直接写 key 的写 key，写不进去的（Codex 只认变量名）给变量名', () => {
    for (const tool of ACCESS_TOOLS) {
      if (tool.setup.kind !== 'snippet') continue
      const code = tool.setup.snippet.render(resolveToolValues(tool, ORIGIN))
      const hasLiteralKey = code.includes(SAMPLE_API_KEY)
      const hasEnvIndirection = code.includes('env_key =')

      expect(hasLiteralKey || hasEnvIndirection, tool.id).toBe(true)
    }
  })

  it('只有在配置里点名模型的工具才写模型名，SDK 片段不替用户决定模型', () => {
    const namingModel = ACCESS_TOOLS.filter(tool => {
      if (tool.setup.kind !== 'snippet') return false
      return tool.setup.snippet.render(resolveToolValues(tool, ORIGIN)).includes(SAMPLE_MODEL_NAME)
    }).map(tool => tool.id)

    expect(namingModel).toEqual(['claudeCode', 'codexCli'])
  })
})

describe('验证命令', () => {
  it('按协议打各自的转发路径，不用本地的 /v1/models 冒充', () => {
    expect(buildVerifyCommand(ORIGIN, 'openai')).toContain(`${ORIGIN}/v1/chat/completions`)
    expect(buildVerifyCommand(ORIGIN, 'anthropic')).toContain(`${ORIGIN}/v1/messages`)
    expect(buildVerifyCommand(ORIGIN, 'anthropic')).not.toContain('/v1/models')
  })

  it('根地址缺失时给空串', () => {
    expect(buildVerifyCommand('', 'openai')).toBe('')
    expect(buildVerifyCommand('', 'anthropic')).toBe('')
  })
})

describe('findAccessTool', () => {
  it('能把每个 id 都取回来', () => {
    for (const tool of ACCESS_TOOLS) {
      expect(findAccessTool(tool.id)).toBe(tool)
    }
  })
})
