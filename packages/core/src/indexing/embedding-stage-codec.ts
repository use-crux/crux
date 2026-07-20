/**
 * Dense and sparse codecs used by embedding-stage orchestration.
 *
 * @module
 */

import type { JsonObject, SparseVector } from '../storage'
import {
  createDenseEmbeddingStageEntry,
  createSparseEmbeddingStageEntry,
  isDenseEmbeddingBundle,
  isSparseEmbeddingBundle,
  readDenseEmbeddingStageEntry,
  readSparseEmbeddingStageEntry,
} from './embedding-stage-cache'

/** Expected identity and vector count for one source cache entry. */
export interface EmbeddingStageEntryContext {
  readonly namespace: string
  readonly sourceId: string
  readonly embeddingFingerprint: string
  readonly inputHash: string
  readonly chunkCount: number
}

/** Kind-specific cache codec and fresh-output validator. */
export interface EmbeddingStageCodec<TVector> {
  isBundle(value: unknown, count: number): value is TVector[]
  read(value: JsonObject | null, context: EmbeddingStageEntryContext): readonly TVector[] | undefined
  create(context: EmbeddingStageEntryContext, vectors: readonly TVector[]): JsonObject
}

/** Build the codec for a configured dense vector width. */
export function denseEmbeddingStageCodec(dimensions: number): EmbeddingStageCodec<number[]> {
  return {
    isBundle: (value, count): value is number[][] => isDenseEmbeddingBundle(value, count, dimensions),
    read: (value, context) =>
      readDenseEmbeddingStageEntry(value, {
        ...context,
        dimensions,
      })?.vectors,
    create: (context, vectors) =>
      createDenseEmbeddingStageEntry({
        ...context,
        dimensions,
        vectors,
      }),
  }
}

/** Cache codec for sparse vectors. */
export const sparseEmbeddingStageCodec: EmbeddingStageCodec<SparseVector> = {
  isBundle: isSparseEmbeddingBundle,
  read: (value, context) => readSparseEmbeddingStageEntry(value, context)?.vectors,
  create: (context, vectors) => createSparseEmbeddingStageEntry({ ...context, vectors }),
}
