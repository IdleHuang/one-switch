import { eq } from 'drizzle-orm'
import type { ProviderHealth, ProviderModelHealth } from '@common/schemas'
import { now } from '@common/utils'
import { getDataDb } from './index'
import { providerHealth, providerModelHealth } from './data-schema'
import type { ProviderHealthRow, ProviderModelHealthRow } from './data-schema'

/**
 * 供应商与供应商模型的健康状态。
 *
 * 这张表属于**观测库**（`./data-schema.ts`）：`recordHealthSuccess` 在每一个成功的请求上都会
 * 跑一次，留在配置库就等于「每个请求都写配置库」。
 *
 * 走观测库的直接后果是**没有外键兜底**——`providerId` 指向配置库的行，而外键不能跨文件，
 * 所以这里的所有写入都必须是 upsert：
 *
 *   - 行不存在时 `update` 影响 0 行、不报错、静默什么都不做。而「第一次成功」与「第一次失败」
 *     恰恰是最常见的那次调用：前者会让连续失败次数永远清不掉，后者会让连续失败次数永远涨不上去
 *     （冷却因此永远不生效）。所以本文件里的写入一律是 upsert。
 *   - 孤儿行（配置里已删除的供应商）由启动时的一次清理收掉，见 `./index.ts`
 *     的 `pruneOrphanHealthRows`。本文件不做任何跨库判断。
 */

export async function getProviderHealth(providerId: string): Promise<ProviderHealth | undefined> {
  const row = getDataDb()
    .select()
    .from(providerHealth)
    .where(eq(providerHealth.providerId, providerId))
    .get()
  return row ? mapProviderHealth(row) : undefined
}

export async function listProviderHealth(): Promise<ProviderHealth[]> {
  return getDataDb().select().from(providerHealth).all().map(mapProviderHealth)
}

export async function recordHealthSuccess(providerId: string): Promise<void> {
  const time = now()
  // 成功一次的语义是确定的：清掉连续失败与冷却，只把「最后一次成功」往前推。
  // 行不存在时按这个语义整行插出来（其余列取默认值）。
  getDataDb()
    .insert(providerHealth)
    .values({ providerId, consecutiveFailures: 0, cooldownUntilTime: null, lastSuccessTime: time, updatedTime: time })
    .onConflictDoUpdate({
      target: providerHealth.providerId,
      set: { consecutiveFailures: 0, cooldownUntilTime: null, lastSuccessTime: time, updatedTime: time },
    })
    .run()
}

export async function recordProviderFailure(providerId: string, consecutiveFailureThreshold: number, cooldownBaseSeconds: number, cooldownMaxSeconds: number): Promise<void> {
  const db = getDataDb()
  const time = now()
  db.transaction(transaction => {
    const current = transaction.select().from(providerHealth).where(eq(providerHealth.providerId, providerId)).get()
    const consecutiveFailures = (current?.consecutiveFailures ?? 0) + 1
    const cooldownUntilTime = calculateCooldownUntil(consecutiveFailures, consecutiveFailureThreshold, cooldownBaseSeconds, cooldownMaxSeconds, time)
    // 读-改-写必须在同一个事务里：并发失败（同一供应商被多个请求同时打中）时
    // 不这样做会丢掉计数。
    transaction
      .insert(providerHealth)
      .values({ providerId, consecutiveFailures, cooldownUntilTime, lastFailureTime: time, updatedTime: time })
      .onConflictDoUpdate({
        target: providerHealth.providerId,
        set: { consecutiveFailures, cooldownUntilTime, lastFailureTime: time, updatedTime: time },
      })
      .run()
  })
}

export async function resetProviderHealth(providerId: string): Promise<void> {
  const time = now()
  // 这里保持 `update` 是对的：行不存在时「全部归零」这个目标本来就已达成，
  // 而凭空插一行会把「从未有过记录」变成「有记录且全零」，让管理页从「无数据」
  // 变成「健康」，那是两种不同的展示。
  getDataDb()
    .update(providerHealth)
    .set({ consecutiveFailures: 0, cooldownUntilTime: null, lastSuccessTime: null, lastFailureTime: null, updatedTime: time })
    .where(eq(providerHealth.providerId, providerId))
    .run()
}

export async function getProviderModelHealth(providerModelId: string): Promise<ProviderModelHealthRow | undefined> {
  return getDataDb().select().from(providerModelHealth).where(eq(providerModelHealth.providerModelId, providerModelId)).get()
}

export async function listProviderModelHealth(): Promise<ProviderModelHealth[]> {
  return getDataDb().select().from(providerModelHealth).all().map(mapProviderModelHealth)
}

export async function recordProviderModelHealthSuccess(providerModelId: string): Promise<void> {
  const time = now()
  getDataDb()
    .insert(providerModelHealth)
    .values({ providerModelId, consecutiveFailures: 0, cooldownUntilTime: null, lastSuccessTime: time, updatedTime: time })
    .onConflictDoUpdate({
      target: providerModelHealth.providerModelId,
      set: { consecutiveFailures: 0, cooldownUntilTime: null, lastSuccessTime: time, updatedTime: time },
    })
    .run()
}

export async function recordProviderModelFailure(providerModelId: string, consecutiveFailureThreshold: number, cooldownBaseSeconds: number, cooldownMaxSeconds: number): Promise<void> {
  const db = getDataDb()
  const time = now()
  db.transaction(transaction => {
    const current = transaction.select().from(providerModelHealth).where(eq(providerModelHealth.providerModelId, providerModelId)).get()
    const consecutiveFailures = (current?.consecutiveFailures ?? 0) + 1
    const cooldownUntilTime = calculateCooldownUntil(consecutiveFailures, consecutiveFailureThreshold, cooldownBaseSeconds, cooldownMaxSeconds, time)
    transaction
      .insert(providerModelHealth)
      .values({ providerModelId, consecutiveFailures, cooldownUntilTime, lastFailureTime: time, updatedTime: time })
      .onConflictDoUpdate({
        target: providerModelHealth.providerModelId,
        set: { consecutiveFailures, cooldownUntilTime, lastFailureTime: time, updatedTime: time },
      })
      .run()
  })
}

export async function resetProviderModelHealth(providerModelId: string): Promise<void> {
  const time = now()
  // 同 `resetProviderHealth`：行不存在时无需插入。
  getDataDb()
    .update(providerModelHealth)
    .set({ consecutiveFailures: 0, cooldownUntilTime: null, lastSuccessTime: null, lastFailureTime: null, updatedTime: time })
    .where(eq(providerModelHealth.providerModelId, providerModelId))
    .run()
}

function calculateCooldownUntil(consecutiveFailures: number, threshold: number, baseSeconds: number, maxSeconds: number, time: number): number | null {
  if (consecutiveFailures < threshold) return null
  const exponent = consecutiveFailures - threshold
  const seconds = Math.min(baseSeconds * Math.pow(2, exponent), maxSeconds)
  return time + seconds * 1000
}

function mapProviderHealth(row: ProviderHealthRow): ProviderHealth {
  return {
    providerId: row.providerId,
    consecutiveFailures: row.consecutiveFailures,
    cooldownUntilTime: row.cooldownUntilTime === null ? null : Number(row.cooldownUntilTime),
    lastSuccessTime: row.lastSuccessTime === null ? null : Number(row.lastSuccessTime),
    lastFailureTime: row.lastFailureTime === null ? null : Number(row.lastFailureTime),
    updatedTime: Number(row.updatedTime),
  }
}

function mapProviderModelHealth(row: ProviderModelHealthRow): ProviderModelHealth {
  return {
    providerModelId: row.providerModelId,
    consecutiveFailures: row.consecutiveFailures,
    cooldownUntilTime: row.cooldownUntilTime === null ? null : Number(row.cooldownUntilTime),
    lastSuccessTime: row.lastSuccessTime === null ? null : Number(row.lastSuccessTime),
    lastFailureTime: row.lastFailureTime === null ? null : Number(row.lastFailureTime),
    updatedTime: Number(row.updatedTime),
  }
}
