import { fetchJson } from '@/shared/services/http'
import type {
  MemoryStore,
  MemoryStoreDetail,
  MemoryOperationRecord,
  Workspace,
  WorkspaceDetail,
  WorkspaceFileDetail,
  PlanSummary,
  PlanDetail,
} from '@/types'

export function buildMemoryOperationsQuery(params: {
  since?: number
  until?: number
  limit?: number
} = {}): string {
  const search = new URLSearchParams()
  if (params.since !== undefined) search.set('since', String(params.since))
  if (params.until !== undefined) search.set('until', String(params.until))
  if (params.limit !== undefined) search.set('limit', String(params.limit))
  return search.size > 0 ? `?${search.toString()}` : ''
}

export const libraryService = {
  memoryStores: (signal?: AbortSignal) => fetchJson<readonly MemoryStore[]>('/api/memory/stores', signal),
  memoryStore: (storeId: string, signal?: AbortSignal) =>
    fetchJson<MemoryStoreDetail>(`/api/memory/stores/${encodeURIComponent(storeId)}`, signal),
  memoryOperations: (
    params: { since?: number; until?: number; limit?: number } = {},
    signal?: AbortSignal,
  ) =>
    fetchJson<readonly MemoryOperationRecord[]>(
      `/api/memory/operations${buildMemoryOperationsQuery(params)}`,
      signal,
    ),
  workspaces: (signal?: AbortSignal) => fetchJson<readonly Workspace[]>('/api/workspaces', signal),
  workspace: (workspaceId: string, signal?: AbortSignal) =>
    fetchJson<WorkspaceDetail>(`/api/workspaces/${encodeURIComponent(workspaceId)}`, signal),
  workspaceFile: (workspaceId: string, filePath: string, signal?: AbortSignal) =>
    fetchJson<WorkspaceFileDetail>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/files/${encodeURIComponent(filePath)}`,
      signal,
    ),
  plans: (signal?: AbortSignal) => fetchJson<readonly PlanSummary[]>('/api/plans', signal),
  plan: (planId: string, signal?: AbortSignal) =>
    fetchJson<PlanDetail>(`/api/plans/${encodeURIComponent(planId)}`, signal),
}
