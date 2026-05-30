/**
 * Observability hooks backed by TanStack Query.
 *
 *   - useObservabilityRuns           → /api/observability/runs (list)
 *   - useObservabilityGraph(runId)   → /api/observability/runs/{runId}
 *   - useObservabilityResourceActivity(family) → /api/observability/resources/{family}
 *
 * Polling cadence is per-query and adapts to status:
 *   - the list polls every 1s while any row is non-terminal
 *   - a single run polls every 1s while it's running, then stops 60s
 *     after it goes terminal (gives stale snapshots a beat to settle)
 *
 * The WS layer in `useDevtools.ts` dispatches a `crux:observability-event`
 * CustomEvent on the window for every `observability.*` notification.
 * We still listen for it and invalidate the matching key so the realtime
 * push path stays sub-second even when the polling interval hasn't fired.
 */

import { useEffect, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { qk } from '@/shared/query/queryClient'
import type {
  CompositionType,
  ObservabilityResourceActivity,
  ObservabilityRunDetail,
  ObservabilityRunDetailNode,
  ObservabilityRunSummary,
} from '@/types'
import type { SpanNode } from '@/features/observability/lib/span-tree'
import { observabilityService } from '../services/observability'

interface ObservabilityGraphState {
  runDetail: ObservabilityRunDetail | null
  spanTree: SpanNode | null
  loading: boolean
  error: Error | null
}

function mapStatus(status: string): SpanNode['status'] {
  if (status === 'ok' || status === 'success' || status === 'skipped') return 'success'
  if (status === 'error' || status === 'cancelled') return 'error'
  if (status === 'stale' || status === 'incomplete' || status === 'warn' || status === 'warning') return 'stale'
  return 'running'
}

function isTerminalStatus(status: string | undefined): boolean {
  return (
    status === 'ok' ||
    status === 'success' ||
    status === 'error' ||
    status === 'cancelled' ||
    status === 'suspended' ||
    status === 'incomplete'
  )
}

function timeMs(timestamp: string): number {
  const parsed = Date.parse(timestamp)
  return Number.isNaN(parsed) ? 0 : parsed
}

function compositionType(primitive: string): CompositionType | undefined {
  switch (primitive) {
    case 'composition.pipeline':
    case 'pipeline':
      return 'pipeline'
    case 'composition.parallel':
    case 'parallel':
      return 'parallel'
    case 'composition.consensus':
    case 'consensus':
      return 'consensus'
    case 'composition.swarm':
    case 'swarm':
      return 'swarm'
    default:
      return undefined
  }
}

function nodeKind(node: ObservabilityRunDetailNode): SpanNode['kind'] {
  switch (node.display?.kind) {
    case 'run':
      return 'session'
    case 'flow':
      return 'flow'
    case 'step':
      return 'step'
    case 'composition':
      return 'composition'
    case 'transition':
      return 'handoff'
    default:
      return 'trace'
  }
}

export function nodeFromRunDetail(node: ObservabilityRunDetailNode, depth: number = 0): SpanNode {
  const comp = compositionType(node.primitive)
  return {
    id: node.id,
    kind: nodeKind(node),
    primitive: node.primitive,
    compositionType: comp,
    label: node.display?.label || node.name || node.primitive || node.spanId || node.id,
    status: mapStatus(node.status),
    durationMs: node.timing?.durationMs ?? node.durationMs,
    startedAt: timeMs(node.timing?.startedAt ?? node.startedAt),
    model: node.model || undefined,
    children: node.children.map((child: ObservabilityRunDetailNode) => nodeFromRunDetail(child, depth + 1)),
    depth,
    composition: comp
      ? {
          kind: comp,
          agentCount: node.children.length,
        }
      : undefined,
  }
}

/** Invalidate the run detail when a matching observability WS event fires. */
function useInvalidateOnObservabilityEvent(targetRunId: string | undefined, queryKey: readonly unknown[]) {
  const client = useQueryClient()
  useEffect(() => {
    function onEvt(event: Event) {
      const refId = (event as CustomEvent<{ refId?: string }>).detail?.refId
      if (targetRunId == null || !refId || refId === targetRunId) {
        void client.invalidateQueries({ queryKey })
      }
    }
    window.addEventListener('crux:observability-event', onEvt)
    return () => window.removeEventListener('crux:observability-event', onEvt)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, targetRunId, queryKey.join('|')])
}

export function useObservabilityGraph(runId: string | undefined): ObservabilityGraphState {
  const key = qk.observability.run(runId)
  useInvalidateOnObservabilityEvent(runId, key)

  const q = useQuery<ObservabilityRunDetail | null, Error>({
    queryKey: key,
    queryFn: ({ signal }) => observabilityService.getRun(runId ?? '', signal),
    enabled: Boolean(runId),
    // While the run is still running, refetch every second. Once it
    // terminates we taper to one more refresh per 5s for 60s, then stop.
    refetchInterval: (query) => {
      const status = (query.state.data as ObservabilityRunDetail | null | undefined)?.run?.status
      if (!isTerminalStatus(status)) return 1000
      const elapsed = Date.now() - (query.state.dataUpdatedAt || 0)
      return elapsed < 60_000 ? 5_000 : false
    },
  })

  const runDetail = q.data ?? null
  const spanTree = useMemo(() => (runDetail ? nodeFromRunDetail(runDetail.root, 0) : null), [runDetail])

  return {
    runDetail,
    spanTree,
    loading: q.isPending || q.isFetching,
    error: q.error ?? null,
  }
}

export function useObservabilityRuns(): {
  runs: ObservabilityRunSummary[]
  loading: boolean
  error: Error | null
} {
  const key = qk.observability.runs()
  useInvalidateOnObservabilityEvent(undefined, key)

  const q = useQuery<ObservabilityRunSummary[], Error>({
    queryKey: key,
    queryFn: ({ signal }) => observabilityService.listRuns(signal),
    refetchInterval: (query) => {
      const data = query.state.data as ObservabilityRunSummary[] | undefined
      // Poll fast while any run is in-flight, slow otherwise.
      return data && data.some((r) => !isTerminalStatus(r.status)) ? 1000 : 5000
    },
  })

  return {
    runs: q.data ?? [],
    loading: q.isPending || q.isFetching,
    error: q.error ?? null,
  }
}

export function useObservabilityResourceActivity(family: string): {
  activity: ObservabilityResourceActivity[]
  loading: boolean
  error: Error | null
} {
  const key = qk.observability.resource(family)
  useInvalidateOnObservabilityEvent(undefined, key)

  const q = useQuery<ObservabilityResourceActivity[], Error>({
    queryKey: key,
    queryFn: ({ signal }) => observabilityService.getResourceActivity(family, signal),
    enabled: Boolean(family),
  })

  return {
    activity: q.data ?? [],
    loading: q.isPending || q.isFetching,
    error: q.error ?? null,
  }
}
