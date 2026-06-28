/**
 * Single pipeline stage execution and result normalization.
 *
 * Runs one stage inside a span with start/end instrumentation hooks, builds its
 * {@link RetrievalStageTrace}, and normalizes the loose stage return shapes
 * (bare array vs `{ queries|hits, warnings }`) into a consistent value.
 *
 * @module
 */

import { observe } from '../observability'
import { getRuntime } from '../runtime/runtime'
import { createStagePreview, emitStageOutputArtifact } from './observability'
import type {
  HitStageResult,
  PlannedRetrievalQuery,
  QueryStageResult,
  RetrievalPipelineStage,
  RetrievalStageTrace,
  RetrieverHit,
} from './types'

/** Run a single pipeline stage with instrumentation, returning its value + trace. */
export async function runPipelineStage<
  T extends { queries: readonly PlannedRetrievalQuery[] } | { hits: readonly RetrieverHit[] },
>(args: {
  retrievalId: string
  retrieverId: string
  pipelineId: string
  namespace: string
  query: string
  stage: RetrievalPipelineStage
  inputQueryCount?: number
  inputHitCount?: number
  run: () => Promise<{ value: T; warnings?: string[] }>
}): Promise<{ value: T; trace: RetrievalStageTrace }> {
  const startedAt = Date.now()
  const eventBase = {
    retrievalId: args.retrievalId,
    retrieverId: args.retrieverId,
    pipelineId: args.pipelineId,
    stageName: args.stage.name,
    stageKind: args.stage.kind,
    phase: args.stage.phase,
    ...(args.inputQueryCount !== undefined ? { inputQueryCount: args.inputQueryCount } : {}),
    ...(args.inputHitCount !== undefined ? { inputHitCount: args.inputHitCount } : {}),
  }
  const span = observe.openSpan({
    name: `${args.stage.phase}:${args.stage.name}`,
    family: 'retrieval',
    primitive: 'retrieval.stage',
    attributes: {
      ...eventBase,
      query: args.query,
    },
  })

  getRuntime().instrumentationHooks?.onRetrievalStageStart?.(eventBase)

  try {
    const result = await span.withContext(args.run)
    const durationMs = Date.now() - startedAt
    const outputQueryCount = 'queries' in result.value ? result.value.queries.length : undefined
    const outputHitCount = 'hits' in result.value ? result.value.hits.length : undefined
    const preview = createStagePreview(result.value)
    const trace: RetrievalStageTrace = {
      name: args.stage.name,
      kind: args.stage.kind,
      phase: args.stage.phase,
      status: 'success',
      ...(args.inputQueryCount !== undefined ? { inputQueryCount: args.inputQueryCount } : {}),
      ...(args.inputHitCount !== undefined ? { inputHitCount: args.inputHitCount } : {}),
      ...(outputQueryCount !== undefined ? { outputQueryCount } : {}),
      ...(outputHitCount !== undefined ? { outputHitCount } : {}),
      durationMs,
      warningCount: result.warnings?.length ?? 0,
      ...(result.warnings?.length ? { warnings: result.warnings } : {}),
      preview,
    }
    getRuntime().instrumentationHooks?.onRetrievalStageEnd?.({
      ...eventBase,
      status: 'success',
      ...(outputQueryCount !== undefined ? { outputQueryCount } : {}),
      ...(outputHitCount !== undefined ? { outputHitCount } : {}),
      durationMs,
      warningCount: result.warnings?.length ?? 0,
      preview,
    })
    span.withContext(() => {
      emitStageOutputArtifact(span.spanId, eventBase, preview, {
        ...(outputQueryCount !== undefined ? { outputQueryCount } : {}),
        ...(outputHitCount !== undefined ? { outputHitCount } : {}),
        warningCount: result.warnings?.length ?? 0,
      })
    })
    span.end({
      attributes: {
        ...(outputQueryCount !== undefined ? { outputQueryCount } : {}),
        ...(outputHitCount !== undefined ? { outputHitCount } : {}),
        warningCount: result.warnings?.length ?? 0,
      },
    })
    return { value: result.value, trace }
  } catch (error) {
    const durationMs = Date.now() - startedAt
    const message = error instanceof Error ? error.message : String(error)
    getRuntime().instrumentationHooks?.onRetrievalStageEnd?.({
      ...eventBase,
      status: 'error',
      durationMs,
      warningCount: 0,
      error: message,
    })
    span.error(error, { status: 'error', warningCount: 0 })
    throw error
  }
}

/** Normalize a query stage result into `{ value: { queries }, warnings? }`. */
export function normalizeQueryStageResult(result: QueryStageResult): {
  value: { queries: readonly PlannedRetrievalQuery[] }
  warnings?: string[]
} {
  if (isPlannedQueryArray(result)) {
    return { value: { queries: result } }
  }
  return { value: { queries: result.queries }, warnings: result.warnings }
}

/** Normalize a hit stage result into `{ value: { hits }, warnings? }`. */
export function normalizeHitStageResult(result: HitStageResult): {
  value: { hits: readonly RetrieverHit[] }
  warnings?: string[]
} {
  if (isRetrieverHitArray(result)) {
    return { value: { hits: result } }
  }
  return { value: { hits: result.hits }, warnings: result.warnings }
}

function isPlannedQueryArray(result: QueryStageResult): result is readonly PlannedRetrievalQuery[] {
  return Array.isArray(result)
}

function isRetrieverHitArray(result: HitStageResult): result is readonly RetrieverHit[] {
  return Array.isArray(result)
}
