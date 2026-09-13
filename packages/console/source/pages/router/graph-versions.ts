import { UNSAVED_ROUTER_GRAPH_VERSION } from '@common/router/types'
import type { RouterGraphSnapshot, RouterGraphVersionSummary } from '@common/router/types'

/**
 * 历史版本的展示模型。
 *
 * 版本本身由服务端存（`workflows` 表，`type = 'router'`），画布只把它翻成列表要显示的样子：
 * 保存时间统一成 ISO 字符串，版本号直接当「恢复第几版」的入参。
 *
 * 这里**没有任何本地存储**：图存在哪、由谁读，都收敛到服务端一处。
 * 从前画布把图存在 localStorage、代理另按内置规则解析逻辑模型，是同一件事的两个副本，
 * 于是「画布里改的图」和「代理实际跑的图」可以不一致 —— 现在只有一份。
 */
export interface RouterGraphVersion {
  /** React key */
  id: string
  /** 单调递增的版本号（v1、v2 …），也是「恢复这一版」时要传的号 */
  sequence: number
  /** 用户给这一版起的名字；没起名时为空串（列表就只显示版本号）。 */
  name: string
  /** 用户给这一版写的说明；没写时为空串。 */
  description: string
  /** 保存时间（ISO 8601） */
  savedAt: string
  /** 该版本的节点数量，用于列表摘要 */
  nodeCount: number
}

/** 服务端摘要 → 列表模型。 */
export function toRouterGraphVersion(summary: RouterGraphVersionSummary): RouterGraphVersion {
  return {
    id: `version-${summary.version}`,
    sequence: summary.version,
    name: summary.name,
    description: summary.description,
    savedAt: new Date(summary.savedAt).toISOString(),
    nodeCount: summary.nodeCount,
  }
}

/** 服务端摘要列表 → 列表模型；顺序沿用服务端给的（新的在前）。 */
export function toRouterGraphVersions(summaries: RouterGraphVersionSummary[]): RouterGraphVersion[] {
  return summaries.map(toRouterGraphVersion)
}

/**
 * 服务端是否已经保存过至少一版图。
 *
 * 一版都没保存过时，读当前生效的图拿到的是内建默认策略（版本号 `UNSAVED_ROUTER_GRAPH_VERSION`）：
 * 它确实是代理此刻在执行的那张图，但不是「用户存下来的图」，所以画布要把它当成「内容尚未保存」——
 * 否则保存按钮一打开就是灰的，用户没办法把这份默认策略存成 v1。
 */
export function hasSavedVersion(snapshot: RouterGraphSnapshot): boolean {
  return snapshot.version !== UNSAVED_ROUTER_GRAPH_VERSION
}

/** `2026-09-11 22:41`，列表里按保存时间倒序展示。 */
export function formatVersionTime(savedAt: string): string {
  const date = new Date(savedAt)
  if (Number.isNaN(date.getTime())) return savedAt
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
