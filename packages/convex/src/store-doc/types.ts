/**
 * Types for the internal Convex store document boundary.
 *
 * These are intentionally structural so generated Convex documents, vector
 * hits, bridge fakes, and React query results can all enter through the same
 * small contract without importing Convex runtime types.
 *
 * @module
 */

import type { ExactFilter, JsonObject, RecordEntry, RecordListOptions, RecordWriteOptions } from '@use-crux/core/storage'

/** Structural Convex document record accepted at the store boundary. */
export type StoreDocRecord = Readonly<Record<string, unknown>>

/** Canonical write payload for the Crux Convex memory component. */
export interface StoreDocWrite extends StoreDocRecord {
  /** Store key. */
  key: string
  /** JSON-stringified `JsonObject` payload. */
  content: string
  /** Component metadata. `_cruxDoc: true` marks the current Crux format. */
  metadata: Record<string, unknown>
  /** Optional dense embedding mirrored at the top level for Convex vector indexes. */
  embedding?: number[]
  /** Last update timestamp in milliseconds. */
  updatedAt: number
}

/** Raw page request shape accepted by component-facing store document ports. */
export interface StoreDocPageQuery {
  /** Required key prefix. */
  prefix: string
  /** Maximum number of records to read. */
  limit?: number
  /** Optional pagination cursor. */
  cursor?: string
}

/**
 * Store-level list query after Crux options are applied.
 *
 * The `filter` field is intentionally not part of `StoreDocPageQuery` because
 * decoded-value filtering belongs to the in-process store-document policy, not
 * to the Convex component query.
 */
export interface StoreDocListQuery extends StoreDocPageQuery {
  /** Optional top-level value filter. */
  filter?: ExactFilter
}

/** Canonical page shape returned by Convex component queries and local fakes. */
export interface StoreDocPage<TDoc extends StoreDocRecord = StoreDocRecord> {
  /** Raw store documents from the component page. */
  docs: readonly TDoc[]
  /** Opaque component cursor for the next page, when more documents exist. */
  cursor?: string
}

/** Dense vector query passed to the optional vector-search port. */
export interface StoreDocDenseSearchQuery {
  /** Dense query vector. */
  vector: number[]
  /** Maximum number of hits to request. */
  limit: number
  /** Exact top-level scalar filter applied before vector result limiting. */
  filter?: ExactFilter
}

/** Small component-facing I/O port used by the deep store implementation. */
export interface ComponentDocumentPort<TDoc extends StoreDocRecord = StoreDocRecord> {
  /** Read one raw document by key. */
  get(key: string): Promise<TDoc | null>
  /** List one page of raw documents by prefix. */
  list(query: StoreDocPageQuery): Promise<StoreDocPage<TDoc>>
  /** Insert or update one canonical document write. */
  put(doc: StoreDocWrite): Promise<void>
  /** Insert one canonical document write only if the key has no active document. */
  insert(doc: StoreDocWrite): Promise<boolean>
  /** Delete one document by key. */
  delete(key: string): Promise<void>
  /** Optional dense vector search over raw documents. */
  searchDense?(query: StoreDocDenseSearchQuery): Promise<readonly TDoc[]>
}

/**
/** Decoded store document with policy metadata surfaced for callers. */
export interface DecodedStoreDoc {
  /** Store key. */
  key: string
  /** Decoded store value. */
  value: JsonObject
  /** Optional vector score from Convex `_score` hits. */
  score?: number
  /** Whether the value is expired at the codec clock time. */
  expired: boolean
  /** Absolute expiry timestamp encoded in the value, when present. */
  expiresAt?: number
  /** Storage format used to decode the record. */
  encoding: 'crux-doc'
}

/** Codec for translating between Crux values and Convex memory documents. */
export interface StoreDocCodec {
  /** Encode a `JsonObject` into the current `_cruxDoc` write format. */
  encode(key: string, value: JsonObject, options?: RecordWriteOptions): StoreDocWrite
  /** Decode a raw record into a `JsonObject` plus format and expiry metadata. */
  decode(doc: StoreDocRecord): DecodedStoreDoc
  /** Decode a React transport value, preserving `undefined` loading and `null` missing states. */
  value(doc: StoreDocRecord | null | undefined): JsonObject | null | undefined
  /** Decode a React transport list, suppressing expired values and applying optional filters. */
  entries(docs: readonly StoreDocRecord[], options?: Pick<RecordListOptions, 'filter'>): RecordEntry[]
  /** Return whether a decoded value matches top-level exact filter semantics. */
  matchesFilter(value: JsonObject, filter?: ExactFilter): boolean
}

/** Options for creating a store document codec. */
export interface StoreDocCodecOptions {
  /** Clock used for `updatedAt` writes and TTL checks. Defaults to `Date.now`. */
  now?: () => number
}
