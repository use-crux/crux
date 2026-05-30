import type { ObservabilityRunSummary, QualityRunRecord } from '@/types'
import type { QualityRunsOptions } from '@/shared/hooks/useQualityApi'
import type { RunKind, RunRow, RunsFilters } from '../types'

export function qualityOptionsFromFilters(filters: RunsFilters): QualityRunsOptions {
  const serverStatus = (filters.status ?? []).filter((s) => s !== 'running')
  return {
    status: serverStatus.length > 0 ? serverStatus : undefined,
    target: filters.target && filters.target.length > 0 ? filters.target : undefined,
    since: sinceFromLast(filters.last),
    search: filters.search?.trim() || undefined,
    sort: 'time',
    order: 'desc',
  }
}

export function canonicalPrimitiveKind(primitive: string): RunKind {
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
    sessionId: stringValue(attributes.sessionId) ?? stringValue(attributes.sessionID),
    model: r.model || undefined,
    provider: r.provider || undefined,
    status: r.status,
    startedAt: Date.parse(r.startedAt) || 0,
    durationMs: r.durationMs,
    tokenCount: numberValue(metrics.totalTokens),
    cost: numberValue(metrics.costUsd) ?? numberValue(metrics.cost),
    feedbackCount: 0,
    childCount: r.spanCount,
    errorMessage,
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
    kind: canonicalPrimitiveKind(r.primitive ?? 'trace'),
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
    feedbackCount: r.feedbackIds?.length ?? 0,
    toolCallCount: r.toolCallCount,
    childCount: r.traceCount,
    cassetteStatus: r.cassetteStatus,
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
