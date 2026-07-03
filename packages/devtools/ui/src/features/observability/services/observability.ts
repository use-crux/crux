import type {
  ObservabilityResourceActivity,
  ObservabilityRunDetail,
  ObservabilityRunSummary,
  ObservabilitySpanEventSummary,
} from '@/types'
import { fetchJson, fetchJsonOr404 } from '@/shared/services/http'

export interface ObservabilitySpanEventsOptions {
  /** Restrict the lazy event read to one event name, for example `token.chunk`. */
  name?: string
  /** Return only events after this server-provided cursor or timestamp. */
  after?: string
  /** Maximum number of span events to fetch. The server applies its own cap. */
  limit?: number
}

export const observabilityService = {
  listRuns(signal?: AbortSignal): Promise<ObservabilityRunSummary[]> {
    return fetchJson<ObservabilityRunSummary[]>('/api/observability/runs', signal)
  },

  getRun(runId: string, signal?: AbortSignal): Promise<ObservabilityRunDetail | null> {
    return fetchJsonOr404<ObservabilityRunDetail>(`/api/observability/runs/${encodeURIComponent(runId)}`, signal)
  },

  /**
   * Fetch lazily stored events for a single span.
   *
   * Run detail deliberately omits high-volume stream payloads such as
   * `token.chunk`; focused panes call this endpoint only for the selected span.
   */
  getSpanEvents(
    runId: string,
    spanId: string,
    options: ObservabilitySpanEventsOptions = {},
    signal?: AbortSignal,
  ): Promise<ObservabilitySpanEventSummary[]> {
    return fetchJson<ObservabilitySpanEventSummary[]>(
      `/api/observability/runs/${encodeURIComponent(runId)}/spans/${encodeURIComponent(spanId)}/events${spanEventsQuery(options)}`,
      signal,
    )
  },

  getResourceActivity(family: string, signal?: AbortSignal): Promise<ObservabilityResourceActivity[]> {
    return fetchJson<ObservabilityResourceActivity[]>(
      `/api/observability/resources/${encodeURIComponent(family)}`,
      signal,
    )
  },
}

function spanEventsQuery(options: ObservabilitySpanEventsOptions): string {
  const params = new URLSearchParams()
  if (options.name) params.set('name', options.name)
  if (options.after) params.set('after', options.after)
  if (options.limit != null) params.set('limit', String(options.limit))
  const query = params.toString()
  return query ? `?${query}` : ''
}
