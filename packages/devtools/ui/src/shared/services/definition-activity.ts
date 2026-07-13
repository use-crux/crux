import type { ObservabilityDefinitionActivitySummary } from '@/types'
import { fetchJson } from './http'

/** Fetch the server-owned per-definition runtime activity rollup. */
export function fetchDefinitionActivity(
  definitionId: string,
  signal?: AbortSignal,
): Promise<ObservabilityDefinitionActivitySummary> {
  return fetchJson<ObservabilityDefinitionActivitySummary>(
    `/api/observability/definitions/${encodeURIComponent(definitionId)}/activity`,
    signal,
  )
}
