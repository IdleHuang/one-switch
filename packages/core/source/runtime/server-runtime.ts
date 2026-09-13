import type { Server } from 'node:http'
import type { RuntimeConfig } from '@common/runtime-config'
import type { SecretStore } from '@common/secret-store'
import { closeDatabases, initDatabases } from '../database'
import { configureSettingsDefaults, getSettings } from '@server/database/settings-store'
import { configureSecretStore } from '@server/infrastructure/secrets/secret-store'
import { configureCoreNetworkConnector, resetCoreNetworkConnector } from '../infrastructure/network/core-network'
import { configureOutboundConnector, createOutboundConnector, destroyOutboundConnector, type SystemProxyResolver } from '../infrastructure/network/outbound-connector'
import { installLogCapture } from '../management/infrastructure/log-buffer'
import { configureShutdownHandshake, type ShutdownHandshake } from '../management/core/shutdown-handshake'
import { startManagementServer, stopManagementServer } from '../management/server'
import { resetManualModels } from '../proxy/routing/manual-routing'
import { startProxyServer, stopProxyServer } from '../proxy/runtime/server'

export interface ServerRuntimeOptions {
  runtimeConfig: RuntimeConfig
  secretStore: SecretStore
  systemProxyResolver?: SystemProxyResolver
  /**
   * 优雅退出握手。桌面形态不需要（进程自己说了算），CLI 需要——见
   * `../management/core/shutdown-handshake.ts`。
   */
  shutdown?: ShutdownHandshake | null
}

/** 启动完成后的实际监听结果，供宿主打印访问地址。 */
export interface ServerEndpoints {
  managementHost: string
  managementPort: number
  /** 实际生效的代理监听地址：来自设置，可能是用户改过的值而不是配置里的默认值。 */
  proxyHost: string
  proxyPort: number
  /** 托管控制台时的静态产物根目录；没托管为 `null`。 */
  webRoot: string | null
}

export class ServerRuntime {
  private state: 'created' | 'starting' | 'running' | 'stopping' | 'stopped' = 'created'
  private managementServer: Server | null = null
  private endpoints: ServerEndpoints | null = null

  constructor(private readonly options: ServerRuntimeOptions) {}

  get status(): string {
    return this.state
  }

  async start(): Promise<ServerEndpoints> {
    if (this.state === 'running') {
      if (!this.endpoints) throw new Error('Server runtime endpoints are missing')
      return this.endpoints
    }
    if (this.state === 'starting') throw new Error('Server runtime is already starting')
    if (this.state === 'stopping') throw new Error('Server runtime is stopping')

    const config = this.options.runtimeConfig
    const webRoot = config.serveWeb ? config.webRoot : null
    this.state = 'starting'
    console.info(`[runtime] start requested environment=${config.environment} proxyPort=${config.proxyPort} managementPort=${config.managementPort} serveWeb=${webRoot !== null}`)
    try {
      resetManualModels()
      configureSecretStore(this.options.secretStore)
      configureSettingsDefaults({ listenHost: config.proxyHost, listenPort: config.proxyPort })
      configureShutdownHandshake(this.options.shutdown ?? null)
      installLogCapture()
      await initDatabases(config.dataDir)
      const outboundConnector = createOutboundConnector(getSettings, this.options.systemProxyResolver)
      await outboundConnector.initialize()
      configureOutboundConnector(outboundConnector, this.options.systemProxyResolver)
      configureCoreNetworkConnector(outboundConnector)
      const settings = await getSettings()
      console.debug(`[runtime] proxy endpoint resolved host=${settings.listenHost} port=${settings.listenPort}`)
      console.info(`[runtime] starting management server host=${config.managementHost} port=${config.managementPort}`)
      this.managementServer = await startManagementServer({
        host: config.managementHost,
        port: config.managementPort,
        environment: config.environment,
        webRoot,
      })
      console.info(`[runtime] management server started listening=${this.managementServer.listening}`)
      console.info(`[runtime] starting proxy server host=${settings.listenHost} port=${settings.listenPort}`)
      await startProxyServer({ host: settings.listenHost, port: settings.listenPort })
      this.endpoints = {
        managementHost: config.managementHost,
        managementPort: config.managementPort,
        proxyHost: settings.listenHost,
        proxyPort: settings.listenPort,
        webRoot,
      }
      this.state = 'running'
      console.info(`[runtime] start completed state=${this.state}`)
      return this.endpoints
    } catch (error) {
      console.error(`[runtime] start failed state=${this.state}`, error)
      try {
        await this.stopResources()
      } catch (cleanupError) {
        console.error('[runtime] start cleanup failed', cleanupError)
      }
      this.state = 'stopped'
      throw error
    }
  }

  async stop(): Promise<void> {
    if (this.state === 'stopped' || this.state === 'created') return
    if (this.state === 'starting') throw new Error('Server runtime is still starting')
    if (this.state === 'stopping') return

    this.state = 'stopping'
    console.info(`[runtime] stop requested state=${this.state}`)
    try {
      await this.stopResources()
    } finally {
      this.state = 'stopped'
      console.info(`[runtime] stop completed state=${this.state}`)
    }
  }

  private async stopResources(): Promise<void> {
    console.info('[runtime] stopping resources')
    const names = ['proxy', 'management'] as const
    const results = await Promise.allSettled([stopProxyServer(), stopManagementServer()])
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') console.debug(`[runtime] resource stopped name=${names[index]}`)
      else console.error(`[runtime] resource stop failed name=${names[index]}`, result.reason)
    })
    destroyOutboundConnector()
    resetCoreNetworkConnector()
    configureShutdownHandshake(null)
    await closeDatabases()
    this.managementServer = null
    this.endpoints = null

    const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (failure) throw failure.reason
    console.info('[runtime] resources stopped')
  }
}
