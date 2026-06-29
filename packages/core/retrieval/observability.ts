/**
 * Instrumentation for retrieval operations and pipeline stages.
 *
 * Wraps a single retrieve in a span with start/end hooks and a hits artifact
 * ({@link runRetrievalOperation}), and provides the artifact/preview emitters
 * shared by the pipeline runner.
 *
 * @module
 */

import { observe } from '../observability'
import { getRuntime } from '../runtime/runtime'
import type {
  PlannedRetrievalQuery,
  RetrievalStagePreview,
  RetrievalStageTrace,
  RetrieverHit,
  RetrieverMode,
} from './types'

let retrievalOperationCounter = 0

/** Run a single retrieve inside a span, emitting hooks and a hits artifact. */
export async function runRetrievalOperation(args: {
  retrieverId: string
  namespace: string
  mode: RetrieverMode
  query: string
  limit?: number
  threshold?: number
  filter?: Record<string, unknown>
  fusion?: 'rrf' | 'dbsf'
  run: () => Promise<RetrieverHit[]>
}): Promise<RetrieverHit[]> {
  const startedAt = Date.now()
  const retrievalId = `${startedAt}-retrieval-${++retrievalOperationCounter}`
  const eventBase = {
    retrievalId,
    retrieverId: args.retrieverId,
    namespace: args.namespace,
    mode: args.mode,
    query: args.query,
    ...(args.limit !== undefined ? { limit: args.limit } : {}),
    ...(args.threshold !== undefined ? { threshold: args.threshold } : {}),
    ...(args.filter ? { filter: args.filter } : {}),
    ...(args.fusion ? { fusion: args.fusion } : {}),
  }

  getRuntime().instrumentationHooks?.onRetrievalStart?.(eventBase)
  const span = observe.openSpan({
    name: `${args.retrieverId}.retrieve`,
    family: 'retrieval',
    primitive: 'retrieval.query',
    attributes: eventBase,
  })

  try {
    const hits = await span.withContext(args.run)
    span.withContext(() => {
      emitRetrievalHitsArtifact(span.spanId, {
        ...eventBase,
        hits,
      })
    })
    span.end({ resultCount: hits.length })
    getRuntime().instrumentationHooks?.onRetrievalEnd?.({
      ...eventBase,
      resultCount: hits.length,
      durationMs: Date.now() - startedAt,
    })
    return hits
  } catch (error) {
    getRuntime().instrumentationHooks?.onRetrievalEnd?.({
      ...eventBase,
      resultCount: 0,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    })
    span.error(error, { resultCount: 0 })
    throw error
  }
}

/** Emit a `retrieval.hits` artifact and produced edge for a retrieve/pipeline result. */
export function emitRetrievalHitsArtifact(
  spanId: ReturnType<typeof observe.openSpan>['spanId'],
  args: {
    retrievalId: string
    retrieverId: string
    pipelineId?: string
    namespace: string
    mode: RetrieverMode | 'pipeline'
    query: string
    limit?: number
    fusion?: 'rrf' | 'dbsf'
    stages?: readonly RetrievalStageTrace[]
    hits: readonly RetrieverHit[]
  },
): void {
  const artifactId = observe.artifact({
    kind: 'retrieval.hits',
    contentType: 'application/json',
    encoding: 'json',
    preview: {
      kind: 'retrieval.hits',
      query: args.query,
      mode: args.mode,
      ...(args.fusion ? { fusion: args.fusion } : {}),
      ...(args.limit !== undefined ? { limit: args.limit } : {}),
      returned: args.hits.length,
      resultCount: args.hits.length,
      hits: args.hits.slice(0, 10).map((hit, index) => retrievalHitPreview(hit, index)),
      ...(args.stages ? { stages: args.stages.map(retrievalStageReportPreview) } : {}),
    },
    attributes: {
      retrievalId: args.retrievalId,
      retrieverId: args.retrieverId,
      namespace: args.namespace,
      mode: args.mode,
      ...(args.pipelineId ? { pipelineId: args.pipelineId } : {}),
      ...(args.limit !== undefined ? { limit: args.limit } : {}),
      ...(args.fusion ? { fusion: args.fusion } : {}),
      returned: args.hits.length,
      resultCount: args.hits.length,
    },
  })
  if (artifactId) {
    observe.edge({
      edgeType: 'retrieval.returned',
      from: { kind: 'span', id: spanId },
      to: { kind: 'artifact', id: artifactId },
      attributes: {
        retrievalId: args.retrievalId,
        retrieverId: args.retrieverId,
        namespace: args.namespace,
        resultCount: args.hits.length,
      },
    })
  }
}

/** Emit an `output` artifact and produced edge for a pipeline stage. */
export function emitStageOutputArtifact(
  spanId: ReturnType<typeof observe.openSpan>['spanId'],
  eventBase: {
    retrievalId: string
    retrieverId: string
    pipelineId: string
    stageName: string
    stageKind: string
    phase: string
  },
  preview: RetrievalStagePreview,
  attributes: Record<string, unknown>,
): void {
  const artifactId = observe.artifact({
    kind: 'output',
    contentType: 'application/json',
    encoding: 'json',
    preview,
    attributes: {
      ...eventBase,
      ...attributes,
      primitive: 'retrieval.stage',
    },
  })
  if (artifactId) {
    observe.edge({
      edgeType: 'produced',
      from: { kind: 'span', id: spanId },
      to: { kind: 'artifact', id: artifactId },
      attributes: { retrievalId: eventBase.retrievalId, stageName: eventBase.stageName, phase: eventBase.phase },
    })
  }
}

/** Build a redacted preview from a stage's query/hit output. */
export function createStagePreview(
  value: { queries: readonly PlannedRetrievalQuery[] } | { hits: readonly RetrieverHit[] },
): RetrievalStagePreview {
  if ('queries' in value) {
    return {
      queries: value.queries.slice(0, 5).map((query) => ({
        query: query.query,
        ...(query.filter ? { filter: query.filter } : {}),
        ...(query.reason ? { reason: query.reason } : {}),
      })),
    }
  }
  return {
    hits: value.hits.slice(0, 5).map((hitItem) => ({
      sourceId: hitItem.sourceId,
      chunkId: hitItem.chunkId,
      score: hitItem.score,
      contentPreview: hitItem.content.slice(0, 240),
    })),
  }
}

function retrievalHitPreview(hit: RetrieverHit, index: number): Record<string, unknown> {
  return {
    rank: index + 1,
    namespace: hit.namespace,
    sourceId: hit.sourceId,
    chunkId: hit.chunkId,
    score: hit.score,
    preview: hit.content.slice(0, 240),
    contentPreview: hit.content.slice(0, 240),
    ...(hit.sourceUrl ? { sourceUrl: hit.sourceUrl } : {}),
    ...(hit.sourcePath ? { sourcePath: hit.sourcePath } : {}),
    ...(hit.parent?.parentId ? { parentId: hit.parent.parentId } : {}),
  }
}

function retrievalStageReportPreview(stage: RetrievalStageTrace): Record<string, unknown> {
  return {
    name: stage.name,
    kind: stage.kind,
    phase: stage.phase,
    status: stage.status,
    ...(stage.inputHitCount !== undefined ? { inHits: stage.inputHitCount } : {}),
    ...(stage.outputHitCount !== undefined ? { outHits: stage.outputHitCount } : {}),
    ...(stage.inputQueryCount !== undefined ? { inQueries: stage.inputQueryCount } : {}),
    ...(stage.outputQueryCount !== undefined ? { outQueries: stage.outputQueryCount } : {}),
    ...(stage.warnings?.length ? { note: stage.warnings.join('; ') } : {}),
  }
}
