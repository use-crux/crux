import { expectOk, fetchJson, postJson } from '@/shared/services/http'
import type {
  RuntimeCancelResponse,
  RuntimeInspectResponse,
  RuntimeRetryResponse,
  RuntimeStatusResponse,
} from '../types'

export const runtimeService = {
  status(signal?: AbortSignal): Promise<RuntimeStatusResponse> {
    return fetchJson<RuntimeStatusResponse>('/api/runtime', signal)
  },

  inspect(workId: string, signal?: AbortSignal): Promise<RuntimeInspectResponse> {
    return fetchJson<RuntimeInspectResponse>(`/api/runtime/work/${encodeURIComponent(workId)}`, signal)
  },

  async retry(workId: string): Promise<RuntimeRetryResponse> {
    const response = await postJson(`/api/runtime/work/${encodeURIComponent(workId)}/retry`, {})
    await expectOk(response, 'retry runtime work')
    return (await response.json()) as RuntimeRetryResponse
  },

  async cancel(workId: string): Promise<RuntimeCancelResponse> {
    const response = await postJson(`/api/runtime/work/${encodeURIComponent(workId)}/cancel`, {})
    await expectOk(response, 'cancel runtime work')
    return (await response.json()) as RuntimeCancelResponse
  },
}
