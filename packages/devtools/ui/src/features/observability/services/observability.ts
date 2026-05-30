import type { ObservabilityResourceActivity, ObservabilityRunDetail, ObservabilityRunSummary } from '@/types'
import { fetchJson, fetchJsonOr404 } from '@/shared/services/http'

export const observabilityService = {
  listRuns(signal?: AbortSignal): Promise<ObservabilityRunSummary[]> {
    return fetchJson<ObservabilityRunSummary[]>('/api/observability/runs', signal)
  },

  getRun(runId: string, signal?: AbortSignal): Promise<ObservabilityRunDetail | null> {
    return fetchJsonOr404<ObservabilityRunDetail>(`/api/observability/runs/${encodeURIComponent(runId)}`, signal)
  },

  getResourceActivity(family: string, signal?: AbortSignal): Promise<ObservabilityResourceActivity[]> {
    return fetchJson<ObservabilityResourceActivity[]>(
      `/api/observability/resources/${encodeURIComponent(family)}`,
      signal,
    )
  },
}
