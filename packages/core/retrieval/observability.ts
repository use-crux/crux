/**
 * Instrumentation for retrieval operations and recipe hit artifacts.
 *
 * Wraps a single retrieve in a span with start/end hooks and a hits artifact
 * ({@link runRetrievalOperation}).
 *
 * @module
 */

import { observe } from '../observability'
import type { RetrieverHit, RetrieverMode } from './types'

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

  const span = observe.openSpan({
    name: `${args.retrieverId}.retrieve`,
    family: 'retrieval',
    primitive: 'retrieval.retrieve',
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
    return hits
  } catch (error) {
    span.error(error, { resultCount: 0 })
    throw error
  }
}

/** Emit a `retrieval.hits` artifact and produced edge for a retrieve or recipe result. */
export function emitRetrievalHitsArtifact(
  spanId: ReturnType<typeof observe.openSpan>['spanId'],
  args: {
    retrievalId: string
    retrieverId: string
    namespace: string
    mode: RetrieverMode | 'recipe'
    query: string
    limit?: number
    fusion?: 'rrf' | 'dbsf'
    recipeId?: string
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
      ...(args.recipeId ? { recipeId: args.recipeId } : {}),
      ...(args.fusion ? { fusion: args.fusion } : {}),
      ...(args.limit !== undefined ? { limit: args.limit } : {}),
      returned: args.hits.length,
      resultCount: args.hits.length,
      hits: args.hits.slice(0, 10).map((hit, index) => retrievalHitPreview(hit, index)),
    },
    attributes: {
      retrievalId: args.retrievalId,
      retrieverId: args.retrieverId,
      namespace: args.namespace,
      mode: args.mode,
      ...(args.recipeId ? { recipeId: args.recipeId } : {}),
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
        ...(args.recipeId ? { recipeId: args.recipeId } : {}),
        resultCount: args.hits.length,
      },
    })
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
