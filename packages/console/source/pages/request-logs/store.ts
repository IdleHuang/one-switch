import { create } from 'zustand'
import type { RequestLogFilter } from './service'

const initialFilter: RequestLogFilter = {
  providerId: 'all',
  providerModelId: 'all',
  logicalModelId: 'all',
  clientProtocol: 'all',
  status: 'all',
  createdTimeFrom: null,
  createdTimeTo: null,
}

interface RequestLogsUiState {
  page: number
  expandedId: string | null
  filter: RequestLogFilter
  setPage: (page: number) => void
  setExpandedId: (id: string | null) => void
  setFilter: (filter: Partial<RequestLogFilter>) => void
}

export const useRequestLogsUiStore = create<RequestLogsUiState>((set) => ({
  page: 1,
  expandedId: null,
  filter: initialFilter,
  setPage: (page) => set({ page }),
  setExpandedId: (expandedId) => set({ expandedId }),
  // 改筛选条件就回第一页，并且把展开的详情收起来：
  // 留着的话详情里讲的是一条已经被新条件筛掉的日志，表格和详情会各说各话。
  setFilter: (filter) => set((state) => ({ page: 1, expandedId: null, filter: { ...state.filter, ...filter } })),
}))
