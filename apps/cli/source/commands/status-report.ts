/**
 * `status` 的报告结构与两种渲染。
 *
 * 文本与 JSON 都由**同一个** `InstanceReport` 渲染而来，这是刻意的：一旦让 JSON 自己
 * 算一遍「运行中/未运行」，两份输出迟早会在某个分支上不一致，而脚本正是照着 JSON 写的。
 *
 * 取词函数由调用方传入（而不是在这里 `cliTranslator()`），这样单测能钉死语言；
 * 目录本身是双语的，跟着系统语言跑的话测出来的文案会随机器变。
 *
 * JSON 的字段名与值都当作**公开契约**：全部小驼峰、状态取枚举字面量、缺值一律 `null`
 * （不是 `"—"`——那个占位符只属于给人看的文本输出）。
 */

import type { CliTranslator } from '../native-i18n'
import { formatEndpoint, formatUrl } from '../host'

/** 未知值的占位符。不是空串：空串看起来像「字段没渲染出来」。 */
export const PLACEHOLDER = '—'

export type InstanceState = 'running' | 'stopped' | 'unresponsive'

export interface Endpoint {
  host: string
  port: number
}

export interface InstanceReport {
  state: InstanceState
  /** 当前 CLI 自己的版本。 */
  cliVersion: string
  dataDir: string
  /** 运行中实例自报的版本；没有实例时为 `null`（与 `cliVersion` 不等即版本漂移）。 */
  instanceVersion: string | null
  pid: number | null
  startedAt: string | null
  management: Endpoint | null
  /** 代理**实际生效**的地址，可能来自设置而不是本次启动传的值。 */
  proxy: Endpoint | null
  consoleUrl: string | null
  /** 运行时文件还在，但它描述的进程已经没了。 */
  staleRuntimeFile: boolean
  /** 仅 `unresponsive` 时有值：管理端口是否真的在监听。`null` 表示没探测。 */
  portListening: boolean | null
}

export function renderStatusLines(t: CliTranslator, report: InstanceReport): string[] {
  const stateLabel = t(
    report.state === 'running'
      ? 'native.cli.status.running'
      : report.state === 'unresponsive'
        ? 'native.cli.status.unresponsive'
        : 'native.cli.status.stopped',
  )

  return [
    t('native.cli.status.title'),
    t('native.cli.status.state', { value: stateLabel }),
    t('native.cli.status.management', { value: endpointText(report.management) }),
    t('native.cli.status.proxy', { value: endpointText(report.proxy) }),
    t('native.cli.status.console', { value: report.consoleUrl ?? PLACEHOLDER }),
    t('native.cli.status.dataDir', { value: report.dataDir }),
    t('native.cli.status.version', { value: report.instanceVersion ?? report.cliVersion }),
    t('native.cli.status.pid', { value: report.pid === null ? PLACEHOLDER : String(report.pid) }),
    t('native.cli.status.startedAt', { value: report.startedAt ?? PLACEHOLDER }),
  ]
}

/** 稳定字段顺序，方便 `status --json | jq` 之外的纯文本对拍（例如冒烟脚本）。 */
export function renderStatusJson(report: InstanceReport): Record<string, unknown> {
  return {
    state: report.state,
    cliVersion: report.cliVersion,
    instanceVersion: report.instanceVersion,
    dataDir: report.dataDir,
    pid: report.pid,
    startedAt: report.startedAt,
    management: endpointJson(report.management),
    proxy: endpointJson(report.proxy),
    consoleUrl: report.consoleUrl,
    staleRuntimeFile: report.staleRuntimeFile,
    portListening: report.portListening,
  }
}

function endpointText(endpoint: Endpoint | null): string {
  return endpoint === null ? PLACEHOLDER : formatEndpoint(endpoint.host, endpoint.port)
}

function endpointJson(endpoint: Endpoint | null): Record<string, unknown> | null {
  if (endpoint === null) return null
  return { host: endpoint.host, port: endpoint.port, url: formatUrl(endpoint.host, endpoint.port) }
}
