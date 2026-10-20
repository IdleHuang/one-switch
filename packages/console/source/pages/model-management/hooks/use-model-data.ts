import { useCallback, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { providerModelApi } from '@/api/models'
import { unwrap } from '@/api/unwrap'
import { useProviders, useProvidersActions, useProvidersLoading } from '@/data/providers'
import { useHealth, useHealthActions } from '@/data/health'
import type { ProviderModelRoute } from '@common/schemas'
import { useModelManagementUiStore } from '../store'

export const modelKeys = { all: ['provider-models'] as const }

/** 数据未就绪时复用的空数组，避免 `?? []` 每次渲染都产生新引用。 */
const EMPTY_MODELS: ProviderModelRoute[] = []

function loadProviderModels(): Promise<ProviderModelRoute[]> {
  return unwrap(providerModelApi.list()).then(data => data.map(model => ({ id: model.id, providerId: model.providerId, modelName: model.modelName, endpoints: model.endpoints.map(endpoint => ({ protocol: endpoint.protocol, endpointUrl: endpoint.url ?? '', customAuthHeader: null, protocolConversionEnabled: endpoint.conversions.some(conversion => conversion.enabled) })), priority: 0, enabled: model.enabled, createdTime: model.createdTime, updatedTime: model.updatedTime, deletedTime: model.deletedTime })))
}

export function useModelData() {
  const client = useQueryClient()
  const providers = useProviders()
  const health = useHealth()
  const providersLoading = useProvidersLoading()
  const { refresh: refreshProviders } = useProvidersActions()
  const { refresh: refreshHealth } = useHealthActions()
  const selectedProviderId = useModelManagementUiStore(state => state.selectedProviderId)
  const setSelectedProviderId = useModelManagementUiStore(state => state.setSelectedProviderId)
  const query = useQuery({ queryKey: modelKeys.all, queryFn: loadProviderModels, refetchInterval: 30_000 })
  const models = query.data ?? EMPTY_MODELS
  const setModels = useCallback((next: ProviderModelRoute[] | ((current: ProviderModelRoute[]) => ProviderModelRoute[])) => client.setQueryData<ProviderModelRoute[]>(modelKeys.all, current => typeof next === 'function' ? next(current ?? []) : next), [client])
  const loadModels = useCallback(async () => { const result = await query.refetch(); return !result.isError }, [query])
  const reload = useCallback(async () => { refreshProviders(); refreshHealth(); await loadModels() }, [loadModels, refreshHealth, refreshProviders])
  /*
   * 自动选中第一个供应商。
   *
   * 判据是「记下的那个还在不在」，不是「有没有记过」：这个选择会跟着窗口一起恢复
   * （`store/page-scratch.ts`），而供应商可能在别处被删掉。只看空不空的话，本机存着
   * 一个已经消失的 id 时，页面会一直停在「请选择供应商」的空状态上，用户还以为供应商
   * 全没了。
   *
   * 必须等 `providers` 有内容再判断：还没加载出来时列表是空的，按「不在列表里」处理会
   * 把用户的选择直接擦掉。
   */
  useEffect(() => {
    if (providers.length === 0) return
    if (providers.some(provider => provider.id === selectedProviderId)) return
    setSelectedProviderId(providers[0].id)
  }, [providers, selectedProviderId, setSelectedProviderId])
  return { providers, health, providersLoading, models, setModels, selectedProviderId, setSelectedProviderId, loading: query.isPending || providersLoading, loadModels, reload }
}
