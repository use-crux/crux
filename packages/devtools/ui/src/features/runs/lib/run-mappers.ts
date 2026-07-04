import type { ObservabilityRunSummary, QualityRunRecord } from '@/types'
import type { QualityRunsOptions } from '@/shared/hooks/useQualityApi'
import type { RunKind, RunRow, RunsFilters } from '../types'

export function qualityOptionsFromFilters(filters: RunsFilters): QualityRunsOptions {
  return {
    status: filters.status && filters.status.length > 0 ? filters.status : undefined,
    target: filters.target && filters.target.length > 0 ? filters.target : undefined,
    model: filters.model && filters.model.length > 0 ? filters.model : undefined,
    has: filters.has ? [filters.has] : undefined,
    since: sinceFromLast(filters.last),
    search: filters.search?.trim() || undefined,
    sort: 'time',
    order: 'desc',
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
  return 'trace'
}

export function rowFromObservabilityRun(r: ObservabilityRunSummary): RunRow {
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
  }
}

/**
 * Merge server-owned observability rollups onto a row sourced from Quality.
 *
 * Completed runs can arrive from the Quality read model first, while session
 * correlators and graph/count rollups belong to the observability list
 * endpoint. Keeping the merge here lets the runs table use one row shape
 * without duplicating backend ownership rules in React components.
 */
export function enrichRunRowFromObservability(row: RunRow, r: ObservabilityRunSummary | undefined): RunRow {
  if (!r) return row
  const observability = rowFromObservabilityRun(r)
  return {
    ...row,
    sessionId: observability.sessionId ?? row.sessionId,
    model: row.model ?? observability.model,
    provider: row.provider ?? observability.provider,
    durationMs: row.durationMs ?? observability.durationMs,
    tokenCount: observability.tokenCount ?? row.tokenCount,
    cost: observability.cost ?? row.cost,
    recordCount: observability.recordCount,
    spanCount: observability.spanCount,
    eventCount: observability.eventCount,
    artifactCount: observability.artifactCount,
    edgeCount: observability.edgeCount,
    childCount: observability.childCount ?? row.childCount,
  }
}

export function rowFromQualityRun(r: QualityRunRecord): RunRow {
  const errVal = r.error
  const errorMessage =
    typeof errVal === 'string'
      ? errVal
      : errVal &&
          typeof errVal === 'object' &&
          'message' in (errVal as Record<string, unknown>) &&
          typeof (errVal as { message?: unknown }).message === 'string'
        ? (errVal as { message: string }).message
        : undefined
  return {
    kind: canonicalPrimitiveKind(r.rootPrimitive ?? r.kind ?? r.primitive ?? 'trace'),
    id: `run:${r.traceId}`,
    traceId: r.traceId,
    target: r.targetId ?? r.promptId ?? r.flowId ?? r.traceId,
    sessionId: r.sessionId,
    model: r.model || undefined,
    provider: r.provider || undefined,
    status: r.status,
    startedAt: r.startedAt,
    durationMs: r.durationMs,
    tokenCount: r.tokenCount,
    cost: r.cost,
    score: r.score,
    feedbackCount: r.feedbackCount ?? r.feedbackIds?.length ?? 0,
    toolCallCount: r.toolCallCount,
    childCount: r.childCount ?? r.spanCount ?? r.traceCount,
    cassetteStatus: r.cassetteStatus,
    diagnosticsCount: r.diagnosticsCount,
    diagnosticsMaxSeverity: r.diagnosticsMaxSeverity,
    errorMessage,
  }
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
