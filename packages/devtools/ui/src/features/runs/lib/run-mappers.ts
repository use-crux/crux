import type { ObservabilityRunsPageOptions, ObservabilityRunSummary, QualityRunRecord } from '@/types'
import type { RunKind, RunRow, RunsFilters } from '../types'

/**
 * Map UI filters onto the one canonical Runs list request (binding spec 04
 * §3): status/session/time-range filters execute server-side, in SQL,
 * before pagination. `target`/`model`/`search`/`has` stay client-side
 * post-filters over that one bounded page — see `useRuns.ts` — because the
 * server doesn't index on them yet; that's refinement filtering of one
 * list, not the client-side dual-source row merge this replaces.
 */
export function runsPageOptionsFromFilters(filters: RunsFilters): ObservabilityRunsPageOptions {
  const since = sinceFromLast(filters.last)
  return {
    status: filters.status && filters.status.length > 0 ? filters.status : undefined,
    since: since != null ? new Date(since).toISOString() : undefined,
    definitionId: filters.definitionId || undefined,
  }
}

export function canonicalPrimitiveKind(primitive: string): RunKind {
  if (primitive === 'composition') return 'pipeline'
  if (primitive === 'agent') return 'agent'
  if (primitive === 'flow') return 'flow'
  if (primitive === 'generation') return 'generate'
  if (primitive === 'retrieval') return 'retrieval'
  if (primitive === 'eval' || primitive === 'operation') return 'trace'
  if (primitive.startsWith('composition.swarm')) return 'swarm'
  if (primitive.startsWith('composition.consensus')) return 'consensus'
  if (primitive.startsWith('composition.pipeline') || primitive.startsWith('composition.parallel')) return 'pipeline'
  if (primitive.startsWith('agent.')) return 'agent'
  if (primitive.startsWith('retrieval.')) return 'retrieval'
  if (primitive.startsWith('generation.')) return 'generate'
  if (primitive.startsWith('flow.')) return 'flow'
  if (primitive === 'defer' || primitive.startsWith('defer.')) return 'defer'
  return 'trace'
}

/**
 * The one canonical row mapper for the Runs list/detail (binding spec 04
 * §3). `ObservabilityRunSummary` (the joined `/runs/page` row) is the sole
 * source of row identity, presence, and graph rollups — this must not be
 * merged client-side with a second, independently-sourced row.
 */
export function rowFromRunSummary(r: ObservabilityRunSummary): RunRow {
  const metrics = r.metrics ?? {}
  const attributes = r.attributes ?? {}
  const errVal = r.error
  const errorMessage =
    typeof errVal === 'string'
      ? errVal
      : errVal && typeof errVal === 'object' && 'message' in errVal && typeof errVal.message === 'string'
        ? errVal.message
        : undefined
  return {
    kind: canonicalPrimitiveKind(r.rootPrimitive),
    id: `run:${r.runId}`,
    traceId: r.runId,
    target: r.name || r.rootPrimitive || r.runId,
    sessionId: r.sessionId ?? stringValue(attributes.sessionId) ?? stringValue(attributes.sessionID),
    model: r.model || undefined,
    provider: r.provider || undefined,
    status: r.status,
    startedAt: Date.parse(r.startedAt) || 0,
    durationMs: r.durationMs,
    tokenCount: numberValue(metrics.totalTokens),
    cost: numberValue(metrics.costUsd) ?? numberValue(metrics.cost),
    feedbackCount: 0,
    recordCount: r.recordCount,
    spanCount: r.spanCount,
    eventCount: r.eventCount,
    artifactCount: r.artifactCount,
    edgeCount: r.edgeCount,
    childCount: r.spanCount,
    errorMessage,
    revision: r.revision,
    segmentCount: r.segmentCount,
    activeSegmentId: r.activeSegmentId,
    orderingConfidence: r.orderingConfidence,
    gapCount: r.gapCount,
    traceAliasConflict: r.traceAliasConflict,
    deliveryHealth: r.deliveryHealth?.status,
  }
}

/**
 * Decorate an already-canonical row with Quality's annotation-only metadata
 * (feedback, score, experiments, cassette linkage, diagnostics). Quality
 * never adds, removes, reorders, or supplies row identity here — it only
 * fills in fields the observability read model doesn't own (spec 04 §5:
 * "Quality annotations use the same row/detail identity and revision rather
 * than a second list becoming authoritative").
 */
export function annotateRunRowWithQuality(row: RunRow, quality: QualityRunRecord | undefined): RunRow {
  if (!quality) return row
  return {
    ...row,
    score: quality.score ?? row.score,
    feedbackCount: quality.feedbackCount ?? quality.feedbackIds?.length ?? row.feedbackCount,
    toolCallCount: quality.toolCallCount ?? row.toolCallCount,
    cassetteStatus: quality.cassetteStatus ?? row.cassetteStatus,
    diagnosticsCount: quality.diagnosticsCount ?? row.diagnosticsCount,
    diagnosticsMaxSeverity: quality.diagnosticsMaxSeverity ?? row.diagnosticsMaxSeverity,
  }
}

/**
 * Quality's run record keys its trace-scoped metadata by `traceId`, which
 * for an observability-sourced run is set to the run's `RunID` (see
 * `qualityRunFromObservabilitySummary` in
 * packages/local/internal/quality/observability.go) — so joining on the
 * canonical row's `traceId` (== runId) is the correct, unambiguous key.
 */
export function qualityAnnotationsByRunId(
  qualityRuns: readonly QualityRunRecord[],
): ReadonlyMap<string, QualityRunRecord> {
  return new Map(qualityRuns.map((run) => [run.traceId, run]))
}

export function sinceFromLast(last: RunsFilters['last'] | undefined): number | undefined {
  if (!last || last === 'all') return undefined
  const now = Date.now()
  switch (last) {
    case '1h':
      return now - 60 * 60_000
    case '24h':
      return now - 24 * 60 * 60_000
    case '7d':
      return now - 7 * 24 * 60 * 60_000
    case '30d':
      return now - 30 * 24 * 60 * 60_000
  }
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}
