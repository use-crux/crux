/**
 * Storage types for `@use-crux/core`.
 *
 * Crux intentionally separates durable document data, vector search, and blob
 * payloads. Adapters may implement one or more capabilities, but user-facing
 * primitives should ask for the capability they actually need.
 *
 * @module
 */

// Core Types

/** Options for `DataStore.set()`. */
export interface SetOptions {
  /**
   * Time-to-live in milliseconds. After this duration, `get()` returns `null`
   * and `list()` excludes the entry. Stores that support TTL handle expiry
   * internally; check `supportsTtl()` to verify.
   */
  ttl?: number
}

/** A JSON-serializable object. All store values are this shape. */
export type JsonObject = Record<string, unknown>

/** A key-value pair returned from the store. */
export interface StoreEntry {
  /** The unique key for this entry. */
  key: string
  /** The stored value. */
  value: JsonObject
}

/** Options for listing entries. */
export interface ListOptions {
  /** Maximum number of entries to return. */
  limit?: number
  /** Key of the last seen entry for pagination. */
  cursor?: string
  /**
   * Filter by top-level value fields.
   * Exact match semantics: `{ status: 'active' }` matches entries where `value.status === 'active'`.
   * `null` matches entries where the field is missing OR explicitly `null`.
   */
  filter?: Record<string, unknown>
}

/** Paginated list result. */
export interface ListResult {
  /** Entries matching the query. */
  entries: StoreEntry[]
  /** Cursor for the next page. `undefined` when no more pages. */
  cursor?: string
}

/** A store entry with its similarity score from vector search. */
export interface ScoredEntry extends StoreEntry {
  /** Similarity score (higher is better). */
  score: number
}

/** Sparse vector representation used by sparse and hybrid-capable stores. */
export interface SparseVector {
  indices: number[]
  values: number[]
}

/** Options for dense vector similarity search. */
export interface VectorSearchOptions {
  /** Maximum number of results to return. Defaults to 10. */
  limit?: number
  /** Minimum similarity score. Defaults to 0. */
  threshold?: number
  /** Filter by top-level value fields. Same semantics as `ListOptions.filter`. */
  filter?: Record<string, unknown>
}

/** Query shape for dense, sparse, and hybrid vector search. */
export interface VectorSearchQuery extends VectorSearchOptions {
  /** Dense query vector. */
  dense?: number[]
  /** Sparse query vector. */
  sparse?: SparseVector
  /** Optional fusion mode for hybrid-capable stores. */
  fusion?: 'rrf' | 'dbsf'
}

/** Optional capability metadata exposed by document data store adapters. */
export interface DataStoreCapabilities {
  ttl?: boolean
  semanticCache?: {
    /** True only when cache vector search is isolated from memory/RAG vectors. */
    isolatedVectorNamespace: boolean
  }
}

/** Optional capability metadata exposed by vector store adapters. */
export interface VectorStoreCapabilities {
  dense?: boolean
  sparse?: boolean
  hybrid?: boolean
  fusion?: ReadonlyArray<'rrf' | 'dbsf'>
}

/** Optional capability metadata exposed by blob store adapters. */
export interface BlobStoreCapabilities {
  multipart?: boolean
  signedUrls?: boolean
  maxBytes?: number
}

// Store Events

/** Event emitted when a value is set. Discriminant: `type: 'set'` always has `value`. */
export interface StoreSetEvent {
  type: 'set'
  key: string
  value: JsonObject
  timestamp: number
}

/** Event emitted when a key is deleted. Discriminant: `type: 'delete'` never has `value`. */
export interface StoreDeleteEvent {
  type: 'delete'
  key: string
  timestamp: number
}

/** Discriminated union of store events. Narrow on `event.type` to access `value`. */
export type StoreEvent = StoreSetEvent | StoreDeleteEvent

// Store Interfaces

/**
 * Durable key-value document store.
 *
 * Use this for memory records, workspace metadata, eval reports, plans, and
 * other JSON-shaped state. It deliberately does not include vector or blob
 * operations.
 */
export interface DataStore {
  readonly _tag?: 'DataStore'

  /** Get a value by key. Returns `null` if not found. */
  get(key: string): Promise<JsonObject | null>

  /** Set a value. Creates or overwrites. Optionally set a TTL for auto-expiry. */
  set(key: string, value: JsonObject, options?: SetOptions): Promise<void>

  /** Delete a key. No-op if not found. */
  delete(key: string): Promise<void>

  /**
   * List entries whose keys start with `prefix`.
   *
   * Results are sorted by `value.updatedAt` descending (newest first).
   * Supports pagination via `cursor` and filtering via `filter`.
   */
  list(prefix: string, options?: ListOptions): Promise<ListResult>

  /**
   * Subscribe to store changes.
   *
   * Returns an unsubscribe function. Events are discriminated unions.
   */
  subscribe?(callback: (event: StoreEvent) => void): () => void

  /**
   * Whether this store supports TTL-based auto-expiry.
   *
   * When `true`, passing `{ ttl }` to `set()` will cause the entry to
   * auto-expire after the specified duration.
   */
  supportsTtl?(): boolean

  /** Adapter capability metadata. Used for fail-fast feature checks. */
  capabilities?(): DataStoreCapabilities
}

/** A vector record stored alongside a document record. */
export interface VectorRecord {
  readonly key: string
  readonly dense?: number[]
  readonly sparse?: SparseVector
  readonly metadata?: Record<string, unknown>
}

/** A vector search hit. Hydrate full records through the matching `DataStore`. */
export interface VectorHit {
  readonly key: string
  readonly score: number
  readonly metadata?: Record<string, unknown>
}

/** Dense, sparse, and hybrid vector search capability. */
export interface VectorStore {
  readonly _tag?: 'VectorStore'

  /** Insert or replace vector records. */
  upsert(records: readonly VectorRecord[]): Promise<void>

  /** Delete vector records by key. */
  delete(keys: readonly string[]): Promise<void>

  /** Search vector records by dense, sparse, or hybrid query. */
  search(query: VectorSearchQuery): Promise<readonly VectorHit[]>

  /** Adapter capability metadata. Used for fail-fast feature checks. */
  capabilities?(): VectorStoreCapabilities
}

export type BlobContent = Uint8Array | Blob | ReadableStream<Uint8Array> | string

export interface BlobPutInput {
  readonly key?: string
  readonly content: BlobContent
  readonly mimeType: string
  readonly metadata?: Record<string, unknown>
}

export interface BlobRef {
  readonly uri: string
  readonly size: number
  readonly sha256?: string
}

export interface BlobReadResult {
  readonly content: BlobContent
  readonly mimeType: string
  readonly size?: number
}

/** Large payload storage for binaries and oversized generated outputs. */
export interface BlobStore {
  readonly _tag?: 'BlobStore'
  put(input: BlobPutInput): Promise<BlobRef>
  get(uri: string): Promise<BlobReadResult>
  delete?(uri: string): Promise<void>
  capabilities?(): BlobStoreCapabilities
}

/** Explicit capability bundle passed to primitives that need storage. */
export interface Storage {
  readonly data: DataStore
  readonly vectors?: VectorStore
  readonly blobs?: BlobStore
}

/** Normalize and freeze a storage capability bundle. */
export function storage(config: Storage): Storage {
  return Object.freeze({ ...config })
}

/**
 * Legacy combined adapter shape used internally while adapters migrate to the
 * explicit `DataStore`/`VectorStore`/`BlobStore` split.
 */
export interface CruxStore extends DataStore {
  vectorSearch?(embedding: number[], options?: VectorSearchOptions): Promise<ScoredEntry[]>
  searchVectors?(query: VectorSearchQuery): Promise<ScoredEntry[]>
  capabilities?(): DataStoreCapabilities & {
    vectorSearch?: {
      dense?: boolean
      sparse?: boolean
      hybrid?: boolean
    }
  }
}

export type CruxStoreCapabilities = ReturnType<NonNullable<CruxStore['capabilities']>>

// Legacy Compatibility

/** Dense embed function — developer provides this, any embedding provider works. */
export type EmbedFn = (text: string) => Promise<number[]>

/** Configuration for generated tool descriptions. */
export interface ToolConfig {
  /** Custom description for the tool. Overrides the auto-generated default. */
  description: string
}
