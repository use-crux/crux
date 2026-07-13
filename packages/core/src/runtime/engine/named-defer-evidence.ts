/**
 * Execution-time evidence for named request-scoped deferred work.
 *
 * Durable finalize creates plain `task.run` work. When that work carries
 * provider-neutral defer provenance, the Runtime execution boundary emits one
 * `defer.run` span grouped under the scheduled public evidence.
 *
 * @module
 */

import {
  observe,
  type CapturedObservabilityContext,
  type CruxSpanId,
} from '../../observability'
import type { JsonValue } from '../../storage'
import type { WorkItem } from './work'

/** JSON-safe defer provenance persisted on intents and task.run work. */
export interface RuntimeNamedDeferProvenance {
  readonly mode: 'named'
  readonly sequence: number
  readonly completion: 'response-finished' | 'handler-returned'
  readonly scopeId: string
  readonly workId: string
  readonly targetId: string
  readonly scheduledAtMs?: number
  readonly runId?: string
  readonly traceId?: string
  /** Durable acceptance-span identity used for the later causal edge. */
  readonly scheduledSpanId: string
}

/** True when a JSON value looks like named defer provenance. */
export function isRuntimeNamedDeferProvenance(
  value: unknown,
): value is RuntimeNamedDeferProvenance {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    record.mode === 'named' &&
    typeof record.sequence === 'number' &&
    (record.completion === 'response-finished' ||
      record.completion === 'handler-returned') &&
    typeof record.scopeId === 'string' &&
    typeof record.workId === 'string' &&
    typeof record.targetId === 'string' &&
    typeof record.scheduledSpanId === 'string'
  )
}

/** Clone provenance into a plain JSON-safe object for durable storage. */
export function cloneNamedDeferProvenance(
  provenance: RuntimeNamedDeferProvenance,
): RuntimeNamedDeferProvenance {
  return Object.freeze({
    mode: 'named' as const,
    sequence: provenance.sequence,
    completion: provenance.completion,
    scopeId: provenance.scopeId,
    workId: provenance.workId,
    targetId: provenance.targetId,
    ...(provenance.scheduledAtMs !== undefined
      ? { scheduledAtMs: provenance.scheduledAtMs }
      : {}),
    ...(provenance.runId ? { runId: provenance.runId } : {}),
    ...(provenance.traceId ? { traceId: provenance.traceId } : {}),
    scheduledSpanId: provenance.scheduledSpanId,
  })
}

/** JSON-safe form suitable for intent/work rows. */
export function namedDeferProvenanceAsJson(
  provenance: RuntimeNamedDeferProvenance,
): JsonValue {
  return cloneNamedDeferProvenance(provenance) as unknown as JsonValue
}

/**
 * Execute one target attempt under a `defer.run` span when work carries named
 * defer provenance. Ordinary task work is a pure pass-through.
 */
export async function executeWithNamedDeferEvidence<T>(
  work: WorkItem,
  execute: () => Promise<T>,
): Promise<T> {
  if (work.work.kind !== 'task.run' || !work.work.defer) {
    return execute()
  }
  const provenance = work.work.defer
  if (!isRuntimeNamedDeferProvenance(provenance)) {
    return execute()
  }

  const scheduledAtMs = provenance.scheduledAtMs ?? Date.now()
  const queueDelayMs = Math.max(0, Date.now() - scheduledAtMs)
  const scheduledSpanId = provenance.scheduledSpanId

  const runContext: CapturedObservabilityContext | undefined =
    provenance.runId && provenance.traceId
      ? {
          runId: provenance.runId as CapturedObservabilityContext['runId'],
          traceId:
            provenance.traceId as CapturedObservabilityContext['traceId'],
          // Durable queued work may execute after its originating grouped run
          // ended. Preserve causal run/trace identity, never temporal nesting.
          spanStack: [],
        }
      : undefined

  const run = async (): Promise<T> => {
    const span = observe.openSpan({
      name: `defer run named ${provenance.targetId}`,
      primitive: 'defer.run',
      attributes: {
        mode: 'named',
        completion: provenance.completion,
        sequence: provenance.sequence,
        targetId: provenance.targetId,
        workId: provenance.workId,
        scopeId: provenance.scopeId,
        queueDelayMs,
      },
      // Restore a captured run when available; otherwise open a lightweight run.
      ...(runContext ? { implicitRun: false as const } : {}),
    })

    observe.edge({
      edgeType: 'triggered',
      from: { kind: 'span', id: scheduledSpanId as CruxSpanId },
      to: { kind: 'span', id: span.spanId },
    })

    try {
      const result = await span.withContext(execute)
      span.end({
        status: 'ok',
        attributes: {
          mode: 'named',
          completion: provenance.completion,
          sequence: provenance.sequence,
          targetId: provenance.targetId,
          workId: provenance.workId,
          scopeId: provenance.scopeId,
          queueDelayMs,
          outcome: 'completed',
        },
      })
      return result
    } catch (error) {
      span.end({
        status: 'error',
        error,
        attributes: {
          mode: 'named',
          completion: provenance.completion,
          sequence: provenance.sequence,
          targetId: provenance.targetId,
          workId: provenance.workId,
          scopeId: provenance.scopeId,
          queueDelayMs,
          outcome: 'failed',
        },
      })
      throw error
    }
  }

  if (runContext) {
    return observe.withContext(runContext, run) as Promise<T>
  }
  return run()
}
