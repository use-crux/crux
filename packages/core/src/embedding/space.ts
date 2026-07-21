/**
 * Dense embedding-space identity and digest helpers.
 *
 * @module
 */

import { sha256Hex } from '../content/sha256'
import type { EmbeddingModality } from './modality'

/**
 * Identity of a dense vector space derived by {@link embedding}.
 *
 * Two dense vectors are comparable if and only if their fingerprints are
 * identical. Sparse embeddings do not expose this contract because they have
 * neither dense dimensions nor a dense search space to guard.
 */
export interface EmbeddingSpace {
  /** Embedding model or authored embedding name. */
  readonly name: string
  /** Provider or model version when it affects vector semantics. */
  readonly version?: string
  /** Number of scalar values in every vector. */
  readonly dimensions: number
  /** Input modalities encoded into this shared vector space. */
  readonly modalities: readonly EmbeddingModality[]
  /** Normalization applied to vectors returned by the provider. */
  readonly normalization: 'unit' | 'none' | 'unknown'
  /** Provider task identifiers that distinguish query and document vectors. */
  readonly tasks?: { readonly query?: string; readonly document?: string }
  /** Full vector-semantic fingerprint shared with the dense embedding. */
  readonly fingerprint: string
}

/**
 * Derive a dense vector-space identity from resolved embedding configuration.
 *
 * The returned value owns copies of nested configuration so later mutations
 * cannot change the embedding instance's declared space.
 *
 * @param config - Resolved dense-space fields except for the fingerprint.
 * @param fingerprint - Full vector-semantic embedding fingerprint.
 * @returns The dense space exposed by the embedding instance.
 */
export function deriveEmbeddingSpace(
  config: Omit<EmbeddingSpace, 'fingerprint'>,
  fingerprint: string,
): EmbeddingSpace {
  const modalities = Object.freeze([...config.modalities])
  const tasks = config.tasks === undefined
    ? undefined
    : Object.freeze({ ...config.tasks })
  return Object.freeze({
    name: config.name,
    ...(config.version === undefined ? {} : { version: config.version }),
    dimensions: config.dimensions,
    modalities,
    normalization: config.normalization,
    ...(tasks === undefined ? {} : { tasks }),
    fingerprint,
  })
}

/**
 * Return the persistent digest for an embedding fingerprint.
 *
 * @param fingerprint - Full vector-semantic embedding fingerprint.
 * @returns The complete 64-character SHA-256 hexadecimal digest.
 */
export function embeddingSpaceDigest(fingerprint: string): string {
  return sha256Hex(new TextEncoder().encode(fingerprint))
}
