/**
 * Embedding cache: the {@link embeddingCache} factory, store codecs, and keys.
 *
 * {@link embeddingCache} wraps a {@link RecordStore} into a namespaced cache. The
 * dense/sparse {@link CacheCodec}s serialize embeddings to/from stored entries,
 * {@link embeddingCacheKey} derives the deterministic key, and the vector guards
 * validate stored payloads.
 *
 * @module
 */

import type { JsonObject, SparseVector } from '../storage'
import { hashString } from './hashing'
import type { NormalizedEmbeddingInput } from './modality'
import type { CacheCodec, EmbeddingCache, EmbeddingCacheOptions } from './types'

/**
 * Build a namespaced {@link EmbeddingCache} backed by a {@link RecordStore}.
 *
 * @param options - Store, namespace (trailing colons stripped), and optional ttl.
 * @returns A frozen embedding cache.
 */
export function embeddingCache(options: EmbeddingCacheOptions): EmbeddingCache {
  if (!options.namespace.trim()) {
    throw new Error('Embedding cache namespace must be non-empty.')
  }
  const namespace = options.namespace.trim().replace(/:+$/g, '')
  if (!namespace) {
    throw new Error('Embedding cache namespace must be non-empty.')
  }
  return Object.freeze({
    _tag: 'EmbeddingCache' as const,
    namespace,
    ttlMs: options.ttlMs,
    get: (key: string) => options.records.get(key),
    set: (key: string, value: JsonObject) =>
      options.records.put(key, value, options.ttlMs === undefined ? undefined : { ttlMs: options.ttlMs }),
  })
}

/** Derive the deterministic cache key for a text under a governance fingerprint. */
export function embeddingCacheKey(namespace: string, governanceFingerprint: string, text: string): string {
  return `${namespace}:v1:${hashString(governanceFingerprint)}:${hashString(text)}`
}

/** Derive a cache key for a normalized input, or skip unsafe media identities. */
export function normalizedEmbeddingCacheKey(
  namespace: string,
  governanceFingerprint: string,
  input: NormalizedEmbeddingInput,
  options: { readonly role: 'query' | 'document'; readonly roleSensitive: boolean },
): string | undefined {
  const role = options.roleSensitive ? `:${options.role}` : ''
  if (input.type === 'text') {
    return `${embeddingCacheKey(namespace, governanceFingerprint, input.text)}${role}`
  }
  if (!input.sha256) return undefined
  return `${namespace}:v1:${hashString(governanceFingerprint)}:media:${input.sha256}${role}`
}

/** Codec serializing dense vectors to/from cache entries. */
export const denseCacheCodec: CacheCodec<number[]> = {
  kind: 'dense',
  read(entry) {
    if (!entry || entry.kind !== 'dense' || !isNumberArray(entry.embedding)) {
      return undefined
    }
    return entry.embedding
  },
  write(embedding) {
    return {
      _tag: 'EmbeddingCacheEntry',
      kind: 'dense',
      embedding,
      createdAt: Date.now(),
    }
  },
}

/** Codec serializing sparse vectors to/from cache entries. */
export const sparseCacheCodec: CacheCodec<SparseVector> = {
  kind: 'sparse',
  read(entry) {
    if (!entry || entry.kind !== 'sparse' || !isSparseVector(entry.embedding)) {
      return undefined
    }
    return entry.embedding
  },
  write(embedding) {
    return {
      _tag: 'EmbeddingCacheEntry',
      kind: 'sparse',
      embedding: {
        indices: [...embedding.indices],
        values: [...embedding.values],
      },
      createdAt: Date.now(),
    }
  },
}

/** Type guard: a value is a `number[]`. */
export function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'number')
}

/** Type guard: a value is a {@link SparseVector}. */
export function isSparseVector(value: unknown): value is SparseVector {
  if (!isRecord(value)) {
    return false
  }
  return isNumberArray(value.indices) && isNumberArray(value.values)
}

/** Type guard: a value is a non-null object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
