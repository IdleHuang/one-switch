/**
 * 预加载脚本：宿主与渲染进程之间唯一的接口面。
 *
 * 两个原则：
 *   1. **不暴露通用通道**。原来是 `sendMessage(channel, data)` / `onMessage(channel, cb)`
 *      一对万能桥——它把「渲染进程能干什么」交回给了渲染进程自己，contextIsolation 白开了。
 *      现在每个能力一个具名方法。
 *   2. **运行时信息由主进程给，不在渲染层重算**。管理 API 的基地址与实例 token 都属于
 *      「启动之后才知道」的东西（token 每次启动都换一个），所以用一次同步 IPC 取回来，
 *      并通过 `contextBridge` 注入 `window.__ONE_SWITCH__`——控制台在它的模块脚本里直接读。
 */

import { contextBridge, ipcRenderer } from 'electron'

export type UpdateCheckStatus =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'update-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export interface ReleaseAsset {
  name: string
  size: number
  downloadUrl: string
}

export interface UpdateInfo {
  currentVersion: string
  latestVersion: string
  releaseNotes: string
  releaseDate: string
  releaseUrl: string
  assets: ReleaseAsset[]
  preferredAsset?: ReleaseAsset
}

export interface UpdateState {
  status: UpdateCheckStatus
  info: UpdateInfo | null
  errorMessage: string | null
  downloadProgress: number | null
  downloadedFile: string | null
}

const updaterApi = {
  getState: (): Promise<UpdateState> => ipcRenderer.invoke('updater:get-state'),
  check: (): Promise<UpdateState> => ipcRenderer.invoke('updater:check'),
  download: (): Promise<boolean> => ipcRenderer.invoke('updater:download'),
  install: (): Promise<void> => ipcRenderer.invoke('updater:install'),
  openReleases: (): Promise<void> => ipcRenderer.invoke('updater:open-releases'),
  onStateChanged: (callback: (state: UpdateState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: UpdateState) => callback(state)
    ipcRenderer.on('updater:state-changed', listener)
    return () => ipcRenderer.removeListener('updater:state-changed', listener)
  },
}

// 暴露给渲染进程的 API
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  openExternal: (url: string): void => ipcRenderer.send('open-external', url),
  updater: updaterApi,
})

/**
 * 运行时信息。
 *
 * 同步取：控制台的第一个请求就可能需要 token，异步到位会让首屏的若干请求先拿一次 403。
 * 主进程在 `whenReady` 之前就注册了这个 handler，所以同步调用不会死等。
 *
 * `token` 缺席时**不写这个字段**，而不是写 `null`：控制台据此判断「凭证还没到位」，
 * 发出去的请求会拿到服务端的 403，而不是在客户端编一个自己的错误码。
 */
const runtime = ipcRenderer.sendSync('runtime:get-config') as { apiBase: string; token: string | null }

contextBridge.exposeInMainWorld('__ONE_SWITCH__', {
  apiBase: runtime.apiBase,
  ...(runtime.token === null ? {} : { token: runtime.token }),
})
