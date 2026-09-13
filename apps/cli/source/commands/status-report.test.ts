import { describe, expect, it } from 'vitest'
import { createAppTranslator } from '@common/i18n/catalogs'
import { renderStatusJson, renderStatusLines, type InstanceReport } from './status-report'

// 取词函数由用例显式传入，语言被钉死。跟着系统语言跑的话，这些断言会在不同机器上
// 给出不同结果——那种测试比没有测试更糟：它会在别人的机器上红。

const t = createAppTranslator('en')

const runningReport: InstanceReport = {
  state: 'running',
  cliVersion: '1.2.3',
  dataDir: 'C:\\data',
  instanceVersion: '1.2.3',
  pid: 4_242,
  startedAt: '2026-01-01T00:00:00.000Z',
  management: { host: '127.0.0.1', port: 9_301 },
  proxy: { host: '0.0.0.0', port: 9_300 },
  consoleUrl: 'http://127.0.0.1:9301',
  staleRuntimeFile: false,
  portListening: null,
}

const stoppedReport: InstanceReport = {
  state: 'stopped',
  cliVersion: '1.2.3',
  dataDir: 'C:\\data',
  instanceVersion: null,
  pid: null,
  startedAt: null,
  management: null,
  proxy: null,
  consoleUrl: null,
  staleRuntimeFile: false,
  portListening: null,
}

describe('renderStatusLines', () => {
  it('keeps the layout fixed no matter how little data there is', () => {
    // 同一条数：布局随数据有无变化，脚本与人眼都得重新适应一次。
    expect(renderStatusLines(t, runningReport)).toHaveLength(9)
    expect(renderStatusLines(t, stoppedReport)).toHaveLength(9)
    expect(renderStatusLines(t, stoppedReport).filter(line => line.includes('—'))).toHaveLength(5)
  })

  it('normalizes the proxy address for the human reader', () => {
    // 通配监听不是能连过去的地址，展示时必须落到回环上。
    expect(renderStatusLines(t, runningReport)[3]).toContain('127.0.0.1:9300')
  })

  it('falls back to the CLI version when no instance reports one', () => {
    expect(renderStatusLines(t, stoppedReport)[6]).toContain('1.2.3')
  })

  it('shows the version the running instance reported', () => {
    const drifted = { ...runningReport, instanceVersion: '1.2.0' }
    expect(renderStatusLines(t, drifted)[6]).toContain('1.2.0')
  })
})

describe('renderStatusJson', () => {
  it('uses null for unknown values instead of the text placeholder', () => {
    const json = renderStatusJson(stoppedReport)
    expect(json).toMatchObject({
      state: 'stopped',
      instanceVersion: null,
      pid: null,
      startedAt: null,
      management: null,
      proxy: null,
      consoleUrl: null,
      portListening: null,
    })
    // 占位符只属于给人看的文本输出：脚本拿到 `"—"` 会当成一个字符串值用下去。
    expect(JSON.stringify(json)).not.toContain('—')
  })

  it('keeps a fixed field order so diffs stay readable', () => {
    expect(Object.keys(renderStatusJson(stoppedReport))).toEqual([
      'state',
      'cliVersion',
      'instanceVersion',
      'dataDir',
      'pid',
      'startedAt',
      'management',
      'proxy',
      'consoleUrl',
      'staleRuntimeFile',
      'portListening',
    ])
  })

  it('carries connectable urls alongside the raw host and port', () => {
    expect(renderStatusJson(runningReport).proxy).toEqual({
      host: '0.0.0.0',
      port: 9_300,
      url: 'http://127.0.0.1:9300',
    })
  })
})
