/**
 * Observability emission for embedding operations.
 *
 * {@link emitEmbeddingOutputArtifact} emits the `embedding.report` artifact and
 * links it to the active span. The preview helpers summarize governance metrics
 * and vector shape (dense dimensions or sparse index/value counts). Internal.
 *
 * @module
 */

import { observe } from '../observability'
import type { JsonObject } from '../storage'
import { isSparseVector } from './cache'
import type { NormalizedEmbeddingInput } from './modality'
import type { BatchExecutionResult, EmbeddingGovernanceMetrics } from './types'

/** Emit the `embedding.report` artifact for an operation and link it to the span. */
export function emitEmbeddingOutputArtifact<T>(
  spanId: ReturnType<typeof observe.openSpan>['spanId'],
  args: {
    name: string
    kind: 'dense' | 'sparse'
    operation: 'embed' | 'embedMany'
    inputs: readonly NormalizedEmbeddingInput[]
    role: 'query' | 'document'
    modalityCounts: Readonly<Record<string, number>>
    embeddingSpace?: string
    batch: Readonly<{ maxSize: number; concurrency: number }>
    dimensions?: number
  },
  result: BatchExecutionResult<T>,
): void {
  const inputCount = args.inputs.length
  const chunkCount = inputCount === 0 ? 0 : Math.ceil(inputCount / args.batch.maxSize)
  const artifactId = observe.artifact({
    kind: 'embedding.report',
    contentType: 'application/json',
    encoding: 'json',
    preview: {
      kind: 'embedding.report',
      embeddingName: args.name,
      embeddingKind: args.kind,
      operation: args.operation,
      role: args.role,
      modalityCounts: args.modalityCounts,
      ...(args.embeddingSpace ? { embeddingSpace: args.embeddingSpace } : {}),
      inputCount,
      chunkCount,
      embeddingCount: result.embeddings.length,
      vectorValuesStored: false,
      ...(args.dimensions !== undefined ? { dimensions: args.dimensions } : {}),
      ...(result.usage ? { usage: result.usage } : {}),
      ...(result.cost !== undefined ? { cost: result.cost } : {}),
      ...embeddingGovernancePreview(result.governance),
      ...embeddingShapePreview(result.embeddings, args.dimensions),
    },
    attributes: {
      primitive: 'embedding.call',
      embeddingName: args.name,
      embeddingKind: args.kind,
      operation: args.operation,
      role: args.role,
      modalityCounts: args.modalityCounts,
      ...(args.embeddingSpace ? { embeddingSpace: args.embeddingSpace } : {}),
      embeddingCount: result.embeddings.length,
      vectorValuesStored: false,
      ...(args.dimensions !== undefined ? { dimensions: args.dimensions } : {}),
      ...embeddingGovernancePreview(result.governance),
    },
  })
  if (!artifactId) return
  observe.edge({
    edgeType: 'produced',
    from: { kind: 'span', id: spanId },
    to: { kind: 'artifact', id: artifactId },
    attributes: { primitive: 'embedding.call', relation: 'embedding-output' },
  })
}

/** Summarize governance metrics (cache ratio, truncations, retries) for previews. */
export function embeddingGovernancePreview(governance: EmbeddingGovernanceMetrics | undefined): JsonObject {
  if (!governance) {
    return {}
  }
  const hitCount = governance.cacheHitCount ?? 0
  const missCount = governance.cacheMissCount ?? 0
  const hasCacheCounts = governance.cacheHitCount !== undefined || governance.cacheMissCount !== undefined
  const totalCache = hitCount + missCount
  return {
    ...(hasCacheCounts ? { cacheHitCount: hitCount, cacheMissCount: missCount } : {}),
    ...(totalCache > 0 ? { cacheHitRatio: hitCount / totalCache } : {}),
    ...(governance.truncatedCount !== undefined ? { truncatedCount: governance.truncatedCount } : {}),
    ...(governance.retryCount !== undefined ? { retryCount: governance.retryCount } : {}),
    ...(governance.rateLimitWaitMs !== undefined ? { rateLimitWaitMs: governance.rateLimitWaitMs } : {}),
  }
}

/** Summarize the shape of the first embedding (dense dims or sparse counts). */
function embeddingShapePreview<T>(embeddings: readonly T[], configuredDimensions?: number): JsonObject {
  const first = embeddings[0]
  if (Array.isArray(first)) {
    return {
      dimensions: configuredDimensions ?? first.length,
      firstVectorLength: first.length,
    }
  }
  if (isSparseVector(first)) {
    return {
      sparseIndexCount: first.indices.length,
      sparseValueCount: first.values.length,
    }
  }
  return {}
}
