import type { ModelTestMode, Protocol } from '@common/schemas'
import type { TranslateParams } from '@common/i18n'
import { request } from './client'

export interface ModelTestRoundResult {
  round: number
  success: boolean
  statusCode?: number
  durationMilliseconds: number
  errorMessage?: string
  inputTokens?: number | null
  outputTokens?: number | null
  ttftMilliseconds?: number | null
  tokensPerSecond?: number | null
}

export interface ModelTestResult {
  modelId: string
  modelName: string
  providerId: string
  providerName: string
  mode: ModelTestMode
  success: boolean
  statusCode?: number
  errorMessage?: string
  errorParams?: TranslateParams
  inputTokens?: number | null
  outputTokens?: number | null
  durationMilliseconds: number
  ttftMilliseconds?: number | null
  tokensPerSecond?: number | null
  /** 逐轮明细；老服务端不返回这个字段，界面据此退回「只有一次结论」的展示。 */
  rounds?: ModelTestRoundResult[]
}

export interface ModelTestFilters { providerIds?: string[]; modelIds?: string[] }

/** 诊断参数。轮次与提示词只影响这一次测试，不写入任何配置。 */
export interface ModelTestOptions {
  rounds?: number
  prompt?: string
  inputLength?: number
}

export const modelTestApi = {
  run: (protocol: Protocol, mode: ModelTestMode, filters: ModelTestFilters = {}, options: ModelTestOptions = {}, signal?: AbortSignal) => request<{ results: ModelTestResult[] }>(
    '/model-test/run',
    { protocol, mode, ...filters, ...options },
    { signal },
  ),
}

export interface ModelConnectivityInput {
  providerId: string
  modelName: string
  /** 这次提交里启用的端点；`endpointUrl` 留空表示用供应商级地址。 */
  endpoints: Array<{ protocol: Protocol; endpointUrl: string }>
}

export interface ModelConnectivityResult {
  protocol: Protocol
  /** 本次实际请求的地址；这一行没有任何可用地址时为 `null`。 */
  endpointUrl: string | null
  success: boolean
  statusCode?: number
  durationMilliseconds: number
  /** 可本地化的错误码；上游原话式的失败没有码，界面直接显示 `errorMessage`。 */
  errorCode?: string
  errorParams?: TranslateParams
  errorMessage?: string
}

/**
 * 模型对话框里的「连接测试」。
 *
 * 与服务端草稿探测一一对应（见 `@osw/core` 的 `routes/diagnostics/model-connectivity.ts`）：
 * 它测的是**表单里还没保存的那一份**，而且只发一次真实请求、不写任何库
 * （请求日志、用量、健康冷却都不动），所以它不是「渠道诊断」的轻量版，
 * 而是另一件事——那一边测的是已保存的配置，并且照实记账。
 */
export const modelConnectivityApi = {
  test: (input: ModelConnectivityInput, signal?: AbortSignal) => request<{ results: ModelConnectivityResult[] }>('/model/connectivity-test', input, { signal }),
}

export const developmentApi = {
  seed: () => request<{ inserted: boolean }>('/development/seed'),
}
