import { useDeferredValue, useMemo } from 'react'
import { useObservabilityRuns } from '@/features/observability/hooks/useObservabilityGraph'
import { useQualityRuns } from '@/shared/hooks/useQualityApi'
import type { RunRow, RunsFilters } from '../types'
import {
  qualityOptionsFromFilters,
  rowFromObservabilityRun,
  rowFromQualityRun,
  sinceFromLast,
} from '../lib/run-mappers'

export interface UseRunsResult {
  allRows: readonly RunRow[]
  distinctTargets: readonly string[]
  distinctModels: readonly string[]
  /** True while the underlying quality-runs query is fetching. Lets the
   *  caller distinguish "loading the first batch" from "fetched, empty". */
  loading: boolean
  /** True while the deferred filter inputs are still settling. UI can
   *  dim the table to communicate that results haven't caught up to the
   *  typed search yet. */
  isFilterPending: boolean
}

export function useRuns(filters: RunsFilters): UseRunsResult {
  const observabilityRuns = useObservabilityRuns()
  // Defer the filter object so the local re-filter happens in a
  // transition rather than blocking the input. The server-side query
  // still uses the live filter (so the URL and server stay authoritative);
  // only the client-side merge/filter pipeline reads the deferred view.
  const deferredFilters = useDeferredValue(filters)
  const isFilterPending = filters !== deferredFilters
  const qualityOpts = useMemo(() => qualityOptionsFromFilters(filters), [filters])
  const qualityRuns = useQualityRuns(qualityOpts)

  const allRows = useMemo<readonly RunRow[]>(() => {
    const qualityRows = (qualityRuns.data ?? []).map(rowFromQualityRun)
    const seen = new Set(qualityRows.map((r) => r.traceId))
    const liveRows: RunRow[] = []

    for (const run of observabilityRuns.runs) {
      if (run.status !== 'running') continue
      if (seen.has(run.runId)) continue
      liveRows.push(rowFromObservabilityRun(run))
    }

    let live: readonly RunRow[] = liveRows
    if (deferredFilters.target && deferredFilters.target.length > 0) {
      const targets = new Set(deferredFilters.target)
      live = live.filter((run) => targets.has(run.target))
    }
    if (deferredFilters.last && deferredFilters.last !== 'all') {
      const since = sinceFromLast(deferredFilters.last)
      if (since != null) live = live.filter((run) => run.startedAt >= since)
    }
    if (deferredFilters.search?.trim()) {
      const query = deferredFilters.search.trim().toLowerCase()
      live = live.filter((run) => `${run.traceId} ${run.target ?? ''} ${run.model ?? ''}`.toLowerCase().includes(query))
    }

    let merged: readonly RunRow[] = [...qualityRows, ...live]
    if (deferredFilters.status && deferredFilters.status.length > 0) {
      const statuses = new Set(deferredFilters.status)
      merged = merged.filter((run) => statuses.has(run.status))
    }
    if (deferredFilters.model && deferredFilters.model.length > 0) {
      const models = new Set(deferredFilters.model)
      merged = merged.filter((run) => run.model != null && models.has(run.model))
    }
    if (deferredFilters.has === 'feedback') {
      merged = merged.filter((run) => run.feedbackCount > 0)
    }
    return merged
  }, [
    qualityRuns.data,
    observabilityRuns.runs,
    deferredFilters,
  ])

  const distinctTargets = useMemo(() => {
    const values = new Set<string>()
    for (const run of observabilityRuns.runs) {
      const name = run.name || run.rootPrimitive || run.runId
      if (name) values.add(name)
    }
    return Array.from(values).sort().slice(0, 50)
  }, [observabilityRuns.runs])

  const distinctModels = useMemo(() => {
    const values = new Set<string>()
    for (const run of observabilityRuns.runs) {
      if (run.model) values.add(run.model)
    }
    return Array.from(values).sort().slice(0, 50)
  }, [observabilityRuns.runs])

  return {
    allRows,
    distinctTargets,
    distinctModels,
    // qualityRuns is the canonical source; observability is push state
    // and never "loading" in the spinner sense.
    loading: qualityRuns.loading,
    isFilterPending,
  }
}
