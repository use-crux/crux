/**
 * Embedding identity resolution.
 *
 * {@link embeddingIdentity} preserves explicit vector-semantic fingerprints
 * and provides a compatibility identity for structural embeddings.
 *
 * @module
 */

import { stableStringify } from './hashing'
import type { CruxEmbedding } from './types'

/**
 * Resolve the vector-semantic identity of an embedding.
 *
 * Prefers the instance's own fingerprint. Structural implementations fall
 * back to their kind, name, and dense dimensions, where renaming remains the
 * documented invalidation mechanism.
 *
 * @param embedding - Dense or sparse embedding to identify.
 * @returns A deterministic identity string.
 *
 * @example
 * ```ts
 * const identity = embeddingIdentity(dense)
 * ```
 */
export function embeddingIdentity(embedding: CruxEmbedding): string {
  if (embedding.fingerprint !== undefined) {
    return embedding.fingerprint
  }
  return stableStringify(
    embedding.kind === 'dense'
      ? { kind: embedding.kind, name: embedding.name, dimensions: embedding.dimensions }
      : { kind: embedding.kind, name: embedding.name },
  )
}
