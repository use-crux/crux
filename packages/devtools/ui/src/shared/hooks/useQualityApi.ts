/**
 * REST hooks for /api/quality/* endpoints, backed by TanStack Query.
 *
 * Each hook returns the same `{ data, loading, error, reload }` shape
 * the call sites already use, so screens didn't change. Internally
 * they're regular `useQuery` calls keyed via the `qk` helper from
 * `lib/queryClient.ts`. The WebSocket layer (`useDevtools.ts`) calls
 * `queryClient.invalidateQueries({ queryKey: qk.quality.all })` on
 * relevant events so a mutation or a server-side update lands in the
 * UI without manual `.reload()` plumbing.
 *
 * Endpoints are documented in
 * `packages/devtools/QUALITY_BACKEND_HANDOVER.md`.
 */

import { useQuery, useQueryClient, useSuspenseQuery, type UseQueryResult } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'
import { qk } from '@/shared/query/queryClient'
import { qualityService, type QualityRunsOptions } from '@/shared/services/quality'
import type {
  QualityOverviewRecord,
  QualityRunRecord,
  QualityRunDetailRecord,
  QualityInsightRecord,
  QualityInsightSilence,
  QualityScorerRecord,
  QualityExperimentSummary,
  QualityExperimentDetail,
  QualityCellEvidence,
  QualityEvaluationProgress,
  QualityBaselineRecord,
  QualityEvaluationManifest,
  QualityFeedbackRecord,
  QualityFeedbackAnnotationRecord,
  QualityFeedbackMemoryProposalRecord,
  QualityCassetteRecord,
} from '@/types'
export type { QualityRunsOptions } from '@/shared/services/quality'

/**
 * Public surface preserved from the previous hand-rolled hooks so
 * existing screens don't need to be updated. Maps Query's native
 * fields onto the legacy shape.
 */
export interface FetchState<T> {
  data: T | null
  loading: boolean
  error: Error | null
  reload: () => void
}

function useAdapted<T>(query: UseQueryResult<T, Error>, invalidateKey: readonly unknown[]): FetchState<T> {
  const client = useQueryClient()
  const keyHash = invalidateKey.join('|')
  const reload = useCallback(() => {
    void client.invalidateQueries({ queryKey: invalidateKey })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, keyHash])
  return {
    data: query.data ?? null,
    loading: query.isPending || query.isFetching,
    error: query.error ?? null,
    reload,
  }
}

export function useQualityOverview(): FetchState<QualityOverviewRecord> {
  const key = qk.quality.overview()
  const q = useQuery<QualityOverviewRecord, Error>({
    queryKey: key,
    queryFn: ({ signal }) => qualityService.overview(signal),
  })
  return useAdapted(q, key)
}

export function useQualityRuns(opts?: QualityRunsOptions): FetchState<readonly QualityRunRecord[]> {
  // Stable cache key derived from the options bag.
  const stableOpts = useMemo(
    () => ({
      status: opts?.status?.join(',') ?? '',
      target: opts?.target?.join(',') ?? '',
      kind: opts?.kind?.join(',') ?? '',
      model: opts?.model?.join(',') ?? '',
      has: opts?.has?.join(',') ?? '',
      session: opts?.session?.join(',') ?? '',
      primitive: opts?.primitive?.join(',') ?? '',
      since: opts?.since,
      until: opts?.until,
      search: opts?.search,
      sort: opts?.sort,
      order: opts?.order,
      limit: opts?.limit,
      offset: opts?.offset,
    }),
    [
      opts?.status,
      opts?.target,
      opts?.kind,
      opts?.model,
      opts?.has,
      opts?.session,
      opts?.primitive,
      opts?.since,
      opts?.until,
      opts?.search,
      opts?.sort,
      opts?.order,
      opts?.limit,
      opts?.offset,
    ],
  )
  const key = qk.quality.runs(stableOpts)
  const q = useQuery<readonly QualityRunRecord[], Error>({
    queryKey: key,
    queryFn: ({ signal }) => qualityService.runs(opts, signal),
  })
  return useAdapted(q, key)
}

export function useQualityRunDetail(traceId: string | null | undefined): FetchState<QualityRunDetailRecord | null> {
  const key = qk.quality.run(traceId)
  const q = useQuery<QualityRunDetailRecord | null, Error>({
    queryKey: key,
    queryFn: ({ signal }) => qualityService.runDetail(traceId ?? '', signal),
    enabled: Boolean(traceId),
    // While the run is still in flight, poll the detail every second so
    // the Replay timeline can grow in near-real-time. (WS invalidations
    // already pump quality cache on event ingest, but a steady tick
    // guarantees forward motion even if the WS hiccups.) Tapers off
    // once the run goes terminal.
    refetchInterval: (query) => {
      if (query.state.data === null) return false
      const status = (query.state.data?.run?.status ?? query.state.data?.trace?.status) as string | undefined
      const terminal =
        status === 'success' ||
        status === 'ok' ||
        status === 'error' ||
        status === 'failed' ||
        status === 'cancelled' ||
        status === 'suspended' ||
        status === 'blocked' ||
        status === 'skipped' ||
        status === 'incomplete' ||
        status === 'stale'
      if (!terminal) return 1000
      const elapsed = Date.now() - (query.state.dataUpdatedAt || 0)
      return elapsed < 30_000 ? 5_000 : false
    },
  })
  return useAdapted(q, key)
}

export function useQualityInsights(): FetchState<readonly QualityInsightRecord[]> {
  const key = qk.quality.insights()
  const q = useQuery<readonly QualityInsightRecord[], Error>({
    queryKey: key,
    queryFn: ({ signal }) => qualityService.insights(signal),
  })
  return useAdapted(q, key)
}

export function useQualityInsightSilences(opts?: {
  includeDeleted?: boolean
}): FetchState<readonly QualityInsightSilence[]> {
  const includeDeleted = opts?.includeDeleted ?? false
  const key = qk.quality.insightSilences({ includeDeleted })
  const q = useQuery<readonly QualityInsightSilence[], Error>({
    queryKey: key,
    queryFn: ({ signal }) => qualityService.insightSilences(includeDeleted, signal),
  })
  return useAdapted(q, key)
}

export function useQualityScorers(): FetchState<readonly QualityScorerRecord[]> {
  const key = qk.quality.scorers()
  const q = useQuery<readonly QualityScorerRecord[], Error>({
    queryKey: key,
    queryFn: ({ signal }) => qualityService.scorers(signal),
  })
  return useAdapted(q, key)
}

export function useQualityExperiments(): FetchState<readonly QualityExperimentSummary[]> {
  const key = qk.quality.experiments()
  const q = useQuery<readonly QualityExperimentSummary[], Error>({
    queryKey: key,
    queryFn: ({ signal }) => qualityService.experiments(signal),
  })
  return useAdapted(q, key)
}

/** Full spec-02 ExperimentRecord for one experiment. Gated on the id. */
export function useQualityExperimentDetail(
  experimentId: string | null | undefined,
): FetchState<QualityExperimentDetail> {
  const key = qk.quality.experiment(experimentId)
  const q = useQuery<QualityExperimentDetail, Error>({
    queryKey: key,
    queryFn: ({ signal }) => qualityService.experimentDetail(experimentId ?? '', signal),
    enabled: Boolean(experimentId),
  })
  return useAdapted(q, key)
}

/**
 * Backend-joined evidence for one case × variant × trial cell. Gated on the
 * triple — only fetches when a cell is actually opened. The backend owns the
 * graceful-degradation paths (source/baseline/trace unavailable), so the UI
 * renders whatever lands here directly.
 */
export function useQualityCellEvidence(
  experimentId: string | null | undefined,
  cell: { caseId: string; variantName: string; trial: number } | null | undefined,
): FetchState<QualityCellEvidence> {
  const key = qk.quality.cellEvidence(experimentId, cell)
  const q = useQuery<QualityCellEvidence, Error>({
    queryKey: key,
    queryFn: ({ signal }) => qualityService.cellEvidence(experimentId ?? '', cell!, signal),
    enabled: Boolean(experimentId && cell),
  })
  return useAdapted(q, key)
}

/**
 * Recent-run trajectory + per-score series for one evaluation, computed by the
 * backend. The outer "is this check trending the right way?" loop on the
 * Evaluation detail. Gated on the id.
 */
export function useQualityEvaluationProgress(
  evaluationId: string | null | undefined,
  limit?: number,
): FetchState<QualityEvaluationProgress> {
  const key = qk.quality.evaluationProgress(evaluationId, limit)
  const q = useQuery<QualityEvaluationProgress, Error>({
    queryKey: key,
    queryFn: ({ signal }) => qualityService.evaluationProgress(evaluationId ?? '', limit, signal),
    enabled: Boolean(evaluationId),
  })
  return useAdapted(q, key)
}

export function useQualityEvaluations(): FetchState<readonly QualityEvaluationManifest[]> {
  const key = qk.quality.evaluations()
  const q = useQuery<readonly QualityEvaluationManifest[], Error>({
    queryKey: key,
    queryFn: ({ signal }) => qualityService.evaluations(signal),
  })
  return useAdapted(q, key)
}

export function useQualityBaselines(): FetchState<readonly QualityBaselineRecord[]> {
  const key = qk.quality.baselines()
  const q = useQuery<readonly QualityBaselineRecord[], Error>({
    queryKey: key,
    queryFn: ({ signal }) => qualityService.baselines(signal),
  })
  return useAdapted(q, key)
}

export function useQualityFeedback(): FetchState<readonly QualityFeedbackRecord[]> {
  const key = qk.quality.feedback()
  const q = useQuery<readonly QualityFeedbackRecord[], Error>({
    queryKey: key,
    queryFn: ({ signal }) => qualityService.feedback(signal),
  })
  return useAdapted(q, key)
}

export function useQualityFeedbackAnnotations(): FetchState<readonly QualityFeedbackAnnotationRecord[]> {
  const key = qk.quality.feedbackAnnotations()
  const q = useQuery<readonly QualityFeedbackAnnotationRecord[], Error>({
    queryKey: key,
    queryFn: ({ signal }) => qualityService.feedbackAnnotations(signal),
  })
  return useAdapted(q, key)
}

export function useQualityFeedbackMemoryProposals(): FetchState<readonly QualityFeedbackMemoryProposalRecord[]> {
  const key = qk.quality.feedbackMemoryProposals()
  const q = useQuery<readonly QualityFeedbackMemoryProposalRecord[], Error>({
    queryKey: key,
    queryFn: ({ signal }) => qualityService.feedbackMemoryProposals(signal),
  })
  return useAdapted(q, key)
}

export function useQualityCassettes(): FetchState<readonly QualityCassetteRecord[]> {
  const key = qk.quality.cassettes()
  const q = useQuery<readonly QualityCassetteRecord[], Error>({
    queryKey: key,
    queryFn: ({ signal }) => qualityService.cassettes(signal),
  })
  return useAdapted(q, key)
}

// ─── Suspense-enabled variants ───────────────────────────────────────
//
// Initial loads suspend (the surrounding `<SectionBoundary fallback=…>`
// provides the skeleton). Background refetches do not re-suspend, so
// WS-driven cache invalidations keep the existing UI visible while new
// data lands. Errors throw and are caught by the same boundary.
//
// Use these inside any component sitting under a SectionBoundary /
// route-level Suspense; the result is always-defined `data` (the
// pending/error states are owned by the boundary).

export function useQualityOverviewSuspense() {
  return useSuspenseQuery({
    queryKey: qk.quality.overview(),
    queryFn: ({ signal }) => qualityService.overview(signal),
  }).data
}

export function useQualityRunsSuspense(opts?: QualityRunsOptions) {
  const stableOpts = useMemo(
    () => ({
      status: opts?.status?.join(',') ?? '',
      target: opts?.target?.join(',') ?? '',
      session: opts?.session?.join(',') ?? '',
      primitive: opts?.primitive?.join(',') ?? '',
      since: opts?.since,
      until: opts?.until,
      search: opts?.search,
      sort: opts?.sort,
      order: opts?.order,
      limit: opts?.limit,
      offset: opts?.offset,
    }),
    [
      opts?.status,
      opts?.target,
      opts?.session,
      opts?.primitive,
      opts?.since,
      opts?.until,
      opts?.search,
      opts?.sort,
      opts?.order,
      opts?.limit,
      opts?.offset,
    ],
  )
  return useSuspenseQuery({
    queryKey: qk.quality.runs(stableOpts),
    queryFn: ({ signal }) => qualityService.runs(opts, signal),
  }).data
}

/** Parametric suspense hook for a single run detail. Same polling
 *  cadence as the non-suspense variant: tight polling while the run is
 *  in-flight, taper after terminal status. */
export function useQualityRunDetailSuspense(traceId: string) {
  return useSuspenseQuery({
    queryKey: qk.quality.run(traceId),
    queryFn: ({ signal }) => qualityService.runDetail(traceId, signal),
    refetchInterval: (query) => {
      if (query.state.data === null) return false
      const status =
        (query.state.data as { run?: { status?: string }; trace?: { status?: string } } | undefined)?.run?.status ??
        (query.state.data as { run?: { status?: string }; trace?: { status?: string } } | undefined)?.trace?.status
      const terminal =
        status === 'success' ||
        status === 'ok' ||
        status === 'error' ||
        status === 'failed' ||
        status === 'cancelled' ||
        status === 'suspended' ||
        status === 'blocked' ||
        status === 'skipped' ||
        status === 'incomplete' ||
        status === 'stale'
      if (!terminal) return 1000
      const elapsed = Date.now() - (query.state.dataUpdatedAt || 0)
      return elapsed < 30_000 ? 5_000 : false
    },
  }).data
}

export function useQualityInsightsSuspense() {
  return useSuspenseQuery({
    queryKey: qk.quality.insights(),
    queryFn: ({ signal }) => qualityService.insights(signal),
  }).data
}

export function useQualityScorersSuspense() {
  return useSuspenseQuery({
    queryKey: qk.quality.scorers(),
    queryFn: ({ signal }) => qualityService.scorers(signal),
  }).data
}

export function useQualityExperimentsSuspense() {
  return useSuspenseQuery({
    queryKey: qk.quality.experiments(),
    queryFn: ({ signal }) => qualityService.experiments(signal),
  }).data
}

/** Parametric suspense hook for one full ExperimentRecord. Caller must
 *  guarantee a non-empty `experimentId` — the hook suspends until data lands. */
export function useQualityExperimentDetailSuspense(experimentId: string) {
  return useSuspenseQuery({
    queryKey: qk.quality.experiment(experimentId),
    queryFn: ({ signal }) => qualityService.experimentDetail(experimentId, signal),
  }).data
}

export function useQualityEvaluationsSuspense() {
  return useSuspenseQuery({
    queryKey: qk.quality.evaluations(),
    queryFn: ({ signal }) => qualityService.evaluations(signal),
  }).data
}

export function useQualityBaselinesSuspense() {
  return useSuspenseQuery({
    queryKey: qk.quality.baselines(),
    queryFn: ({ signal }) => qualityService.baselines(signal),
  }).data
}

export function useQualityFeedbackSuspense() {
  return useSuspenseQuery({
    queryKey: qk.quality.feedback(),
    queryFn: ({ signal }) => qualityService.feedback(signal),
  }).data
}

export function useQualityCassettesSuspense() {
  return useSuspenseQuery({
    queryKey: qk.quality.cassettes(),
    queryFn: ({ signal }) => qualityService.cassettes(signal),
  }).data
}
