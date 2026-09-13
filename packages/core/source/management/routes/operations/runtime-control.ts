import type { IncomingMessage, ServerResponse } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { getSettings } from '@server/database/settings-store'
import { listProviderHealth, listProviderModelHealth } from '@server/database/health-store'
import { getManualModel, setManualModel } from '../../../proxy/routing/manual-routing'
import {
  getProxyServerStatus,
  restartProxyServer,
  startProxyServer,
  stopProxyServer,
} from '../../../proxy/runtime/server'
import type { ManagementHandler } from '../../core/response'
import { sendError, sendSuccess } from '../../core/response'
import { getShutdownHandshake } from '../../core/shutdown-handshake'
import { HttpRouter } from '@server/http-router'

export const runtimeControlRoutes = new HttpRouter<ManagementHandler>()
  .post('/api/logical-model/status', handleLogicalModelStatus)
  .post('/api/logical-model/switch', handleLogicalModelSwitch)
  .post('/api/health/list', handleListHealth)
  .post('/api/proxy/status', handleProxyStatus)
  .post('/api/proxy/start', handleProxyStart)
  .post('/api/proxy/stop', handleProxyStop)
  .post('/api/proxy/restart', handleProxyRestart)
  .post('/api/runtime/shutdown', handleRuntimeShutdown)

const LogicalModelStatusSchema = z.object({ logicalModelId: z.string().min(1) })
function handleLogicalModelStatus(_req: IncomingMessage, res: ServerResponse, body: unknown): void {
  const { logicalModelId } = LogicalModelStatusSchema.parse(body)
  sendSuccess(res, { logicalModelId, manualModelId: getManualModel(logicalModelId) })
}

const SwitchLogicalModelSchema = z.object({ logicalModelId: z.string().min(1), modelId: z.string().nullable() })
function handleLogicalModelSwitch(_req: IncomingMessage, res: ServerResponse, body: unknown): void {
  const { logicalModelId, modelId } = SwitchLogicalModelSchema.parse(body)
  setManualModel(logicalModelId, modelId)
  console.info(`[management] manual route updated logicalModelId=${logicalModelId} providerModelId=${modelId ?? 'automatic'}`)
  sendSuccess(res, { logicalModelId, modelId })
}

async function handleListHealth(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  const [providers, providerModels] = await Promise.all([listProviderHealth(), listProviderModelHealth()])
  sendSuccess(res, { providers, providerModels })
}

async function handleProxyStatus(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  sendSuccess(res, await getProxyServerStatus())
}

async function handleProxyStart(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  console.info('[management] proxy start requested')
  await startProxyServer()
  const status = await getProxyServerStatus()
  console.info(`[management] proxy start completed host=${status.host} port=${status.port} running=${status.running}`)
  sendSuccess(res, status)
}

async function handleProxyStop(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  console.info('[management] proxy stop requested')
  await stopProxyServer()
  const status = await getProxyServerStatus()
  console.info(`[management] proxy stop completed host=${status.host} port=${status.port} running=${status.running}`)
  sendSuccess(res, status)
}

async function handleProxyRestart(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  console.info('[management] proxy restart requested')
  const settings = await getSettings()
  await restartProxyServer({ host: settings.listenHost, port: settings.listenPort })
  const status = await getProxyServerStatus()
  console.info(`[management] proxy restart completed host=${status.host} port=${status.port} running=${status.running}`)
  sendSuccess(res, status)
}

/**
 * 请求宿主优雅退出。
 *
 * 端点只在宿主显式配置了握手时存在（CLI 会配，桌面形态不会），token 每次启动随机并写在
 * 数据目录的运行时文件里——见 `../../core/shutdown-handshake.ts` 的说明。
 */
function handleRuntimeShutdown(req: IncomingMessage, res: ServerResponse): void {
  const handshake = getShutdownHandshake()
  if (!handshake) {
    sendError(res, 'RESOURCE_NOT_FOUND', 'Runtime shutdown endpoint is not enabled', 404)
    return
  }

  const provided = readShutdownToken(req)
  if (!provided || !matchesSecret(provided, handshake.token)) {
    console.warn('[management] runtime shutdown rejected reason=invalid-token')
    sendError(res, 'FORBIDDEN', 'Invalid shutdown token', 403)
    return
  }

  console.info('[management] runtime shutdown accepted')
  // 先把响应写回去再触发停止：宿主一收尾就会关掉监听，不能让自己的响应被一起掐掉。
  res.once('finish', () => handshake.onRequest())
  sendSuccess(res, { stopping: true })
}

function readShutdownToken(req: IncomingMessage): string | null {
  const header = req.headers['x-one-switch-token']
  if (Array.isArray(header)) return header[0] ?? null
  return header ?? null
}

/** 定长比较，避免用比较耗时泄漏 token。 */
function matchesSecret(provided: string, expected: string): boolean {
  const providedBytes = Buffer.from(provided)
  const expectedBytes = Buffer.from(expected)
  if (providedBytes.length !== expectedBytes.length) return false
  return timingSafeEqual(providedBytes, expectedBytes)
}
