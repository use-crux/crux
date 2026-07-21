/**
 * Embedding-stage cache identity and record validation.
 *
 * Keeps source-bundle cache keys and JSON codecs separate from embedding
 * orchestration so stale or malformed vectors never cross the cache boundary.
 *
 * @module
 */

import { sha256Hex } from '../content/sha256'
import type { JsonObject, SparseVector } from '../storage'
import { stableStringify } from './hash'
import type { CruxChunk } from './types'

/** Cache-format epoch for embedding-stage bundle keys and records. */
export const EMBEDDING_STAGE_CACHE_EPOCH = 3

/** Collision-resistant digest of a JSON-serializable value. */
function digest(value: unknown): string {
  return sha256Hex(new TextEncoder().encode(stableStringify(value)))
}

/** Persisted dense vector bundle for one source and embedding identity. */
export interface DenseEmbeddingStageEntry extends JsonObject {
  readonly _cruxRecordType: 'pipeline-embedding-cache'
  readonly version: typeof EMBEDDING_STAGE_CACHE_EPOCH
  readonly kind: 'dense'
  readonly namespace: string
  readonly sourceId: string
  readonly embeddingFingerprint: string
  readonly inputHash: string
  readonly dimensions: number
  readonly vectors: readonly number[][]
  readonly createdAt: number
  readonly updatedAt: number
}

/** JSON-compatible sparse vector stored inside a cache bundle. */
export interface StoredSparseVector extends JsonObject, SparseVector {
  readonly indices: readonly number[]
  readonly values: readonly number[]
}

/** Persisted sparse vector bundle for one source and embedding identity. */
export interface SparseEmbeddingStageEntry extends JsonObject {
  readonly _cruxRecordType: 'pipeline-embedding-cache'
  readonly version: typeof EMBEDDING_STAGE_CACHE_EPOCH
  readonly kind: 'sparse'
  readonly namespace: string
  readonly sourceId: string
  readonly embeddingFingerprint: string
  readonly inputHash: string
  readonly vectors: readonly StoredSparseVector[]
  readonly createdAt: number
  readonly updatedAt: number
}

interface DenseEntryExpectation {
  readonly namespace: string
  readonly sourceId: string
  readonly embeddingFingerprint: string
  readonly inputHash: string
  readonly chunkCount: number
  readonly dimensions: number
}

type SparseEntryExpectation = Omit<DenseEntryExpectation, 'dimensions'>

/**
 * Derive an input hash from ordered text and byte-addressed media chunks.
 *
 * Returns `undefined` when any media content lacks a locally provable digest,
 * making that source compute-only for this run.
 */
export function embeddingStageInputHash(
  orderedChunks: readonly Pick<CruxChunk, 'content' | 'media'>[],
): string | undefined {
  const identities: string[] = []
  for (const chunk of orderedChunks) {
    if (!chunk.media) {
      identities.push(chunk.content)
      continue
    }
    if (!chunk.media.sha256) return undefined
    identities.push(`media:${chunk.media.sha256}`)
  }
  return digest(identities)
}

/** Build the record-store key for one source and embedding kind. */
export function embeddingStageCacheKey(args: {
  scope: string
  namespace: string
  sourceId: string
  kind: 'dense' | 'sparse'
  embeddingFingerprint: string
  inputHash: string
}): string {
  return `indexer:${args.scope}:namespace:${args.namespace}:embedding-cache:${digest({
    epoch: EMBEDDING_STAGE_CACHE_EPOCH,
    sourceId: args.sourceId,
    kind: args.kind,
    embeddingFingerprint: args.embeddingFingerprint,
    inputHash: args.inputHash,
  })}`
}

/** Create a validated dense embedding-stage cache entry. */
export function createDenseEmbeddingStageEntry(
  args: DenseEntryExpectation & {
    vectors: readonly (readonly number[])[]
    now?: number
  },
): DenseEmbeddingStageEntry {
  if (!isDenseEmbeddingBundle(args.vectors, args.chunkCount, args.dimensions)) {
    throw new Error('Dense embedding output does not match the expected count and dimensions.')
  }
  const now = args.now ?? Date.now()
  return {
    _cruxRecordType: 'pipeline-embedding-cache',
    version: EMBEDDING_STAGE_CACHE_EPOCH,
    kind: 'dense',
    namespace: args.namespace,
    sourceId: args.sourceId,
    embeddingFingerprint: args.embeddingFingerprint,
    inputHash: args.inputHash,
    dimensions: args.dimensions,
    vectors: args.vectors.map((vector) => [...vector]),
    createdAt: now,
    updatedAt: now,
  }
}

/** Read a dense cache entry only when its identity and complete vector shape match. */
export function readDenseEmbeddingStageEntry(
  value: unknown,
  expected: DenseEntryExpectation,
): DenseEmbeddingStageEntry | undefined {
  if (
    !isRecord(value) ||
    value._cruxRecordType !== 'pipeline-embedding-cache' ||
    value.version !== EMBEDDING_STAGE_CACHE_EPOCH ||
    value.kind !== 'dense' ||
    value.namespace !== expected.namespace ||
    value.sourceId !== expected.sourceId ||
    value.embeddingFingerprint !== expected.embeddingFingerprint ||
    value.inputHash !== expected.inputHash ||
    value.dimensions !== expected.dimensions ||
    !isDenseEmbeddingBundle(value.vectors, expected.chunkCount, expected.dimensions)
  ) {
    return undefined
  }
  return value as unknown as DenseEmbeddingStageEntry
}

/** Create a validated sparse embedding-stage cache entry. */
export function createSparseEmbeddingStageEntry(
  args: SparseEntryExpectation & {
    vectors: readonly SparseVector[]
    now?: number
  },
): SparseEmbeddingStageEntry {
  if (!isSparseEmbeddingBundle(args.vectors, args.chunkCount)) {
    throw new Error('Sparse embedding output does not match the expected count and shape.')
  }
  const now = args.now ?? Date.now()
  return {
    _cruxRecordType: 'pipeline-embedding-cache',
    version: EMBEDDING_STAGE_CACHE_EPOCH,
    kind: 'sparse',
    namespace: args.namespace,
    sourceId: args.sourceId,
    embeddingFingerprint: args.embeddingFingerprint,
    inputHash: args.inputHash,
    vectors: args.vectors.map((vector) => ({
      indices: [...vector.indices],
      values: [...vector.values],
    })),
    createdAt: now,
    updatedAt: now,
  }
}

/** Read a sparse cache entry only when its identity and complete vector shape match. */
export function readSparseEmbeddingStageEntry(
  value: unknown,
  expected: SparseEntryExpectation,
): SparseEmbeddingStageEntry | undefined {
  if (
    !isRecord(value) ||
    value._cruxRecordType !== 'pipeline-embedding-cache' ||
    value.version !== EMBEDDING_STAGE_CACHE_EPOCH ||
    value.kind !== 'sparse' ||
    value.namespace !== expected.namespace ||
    value.sourceId !== expected.sourceId ||
    value.embeddingFingerprint !== expected.embeddingFingerprint ||
    value.inputHash !== expected.inputHash ||
    !isSparseEmbeddingBundle(value.vectors, expected.chunkCount)
  ) {
    return undefined
  }
  return value as unknown as SparseEmbeddingStageEntry
}

/** Whether a dense bundle is complete, dimensionally exact, and finite. */
export function isDenseEmbeddingBundle(
  value: unknown,
  expectedCount: number,
  dimensions: number,
): value is number[][] {
  return (
    Array.isArray(value) &&
    value.length === expectedCount &&
    value.every(
      (vector) =>
        Array.isArray(vector) &&
        vector.length === dimensions &&
        vector.every((item) => typeof item === 'number' && Number.isFinite(item)),
    )
  )
}

/** Whether a sparse bundle is complete and valid for vector storage. */
export function isSparseEmbeddingBundle(
  value: unknown,
  expectedCount: number,
): value is SparseVector[] {
  return (
    Array.isArray(value) &&
    value.length === expectedCount &&
    value.every((vector) => {
      if (!isRecord(vector) || !Array.isArray(vector.indices) || !Array.isArray(vector.values)) {
        return false
      }
      if (vector.indices.length !== vector.values.length) {
        return false
      }
      if (!vector.values.every((item) => typeof item === 'number' && Number.isFinite(item))) {
        return false
      }
      const indices = vector.indices
      return (
        indices.every((item) => typeof item === 'number' && Number.isInteger(item) && item >= 0) &&
        new Set(indices).size === indices.length
      )
    })
  )
}

/** Whether a value is a non-null record. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
