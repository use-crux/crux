/**
 * Public Storage Beta type surface.
 *
 * Storage is split into JSON records, vector indexes, and blob payloads so
 * primitives can ask for the smallest capability they require.
 *
 * @module
 */

/** JSON primitive values accepted by record stores and metadata filters. */
export type JsonPrimitive = string | number | boolean | null

/** Recursive JSON value accepted by public storage APIs. */
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue | undefined }

/** JSON object value stored by {@link RecordStore}. */
export interface JsonObject {
  readonly [key: string]: JsonValue | undefined
}

/** Scalar value supported by exact top-level filters. */
export type FilterValue = string | number | boolean | null

/** Exact top-level scalar equality filter. */
export type ExactFilter = {
  readonly [key: string]: FilterValue
}

/** Options for {@link RecordStore.put} and {@link RecordStore.create}. */
export interface RecordWriteOptions {
  /** Time-to-live in milliseconds. Requires a store with TTL support. */
  readonly ttlMs?: number
}

/** Batched record write input. */
export interface RecordWrite<T extends JsonObject = JsonObject> {
  /** Store key. */
  readonly key: string
  /** JSON value to write. */
  readonly value: T
  /** Optional write options for this record. */
  readonly options?: RecordWriteOptions
}

/** Record entry returned from list and scan operations. */
export interface RecordEntry<T extends JsonObject = JsonObject> {
  /** Store key. */
  readonly key: string
  /** JSON value for this key. */
  readonly value: T
}

/** Options for listing record pages. */
export interface RecordListOptions {
  /** Maximum number of records to return. */
  readonly limit?: number
  /** Cursor returned by a previous list call. */
  readonly cursor?: string
  /** Exact top-level scalar equality filter. */
  readonly filter?: ExactFilter
}

/** One page of records returned by {@link RecordStore.list}. */
export interface RecordPage<T extends JsonObject = JsonObject> {
  /** Records in this page. */
  readonly entries: readonly RecordEntry<T>[]
  /** Cursor for the next page, absent when iteration is complete. */
  readonly cursor?: string
}

/** Event emitted by a record store watch subscription. */
export type RecordEvent<T extends JsonObject = JsonObject> =
  | {
      readonly type: 'put'
      readonly key: string
      readonly value: T
      readonly timestamp: number
    }
  | {
      readonly type: 'delete'
      readonly key: string
      readonly timestamp: number
    }

/** Record store capability levels. */
export interface RecordStoreCapabilities {
  /** TTL support: backend-native, lazy adapter-managed, or unsupported. */
  readonly ttl: 'native' | 'lazy' | false
  /** Exact filter support: backend-native, scan fallback, or unsupported. */
  readonly filter: 'native' | 'scan' | false
  /** Whether watch subscriptions are supported. */
  readonly watch: boolean
  /** Whether native batch operations are supported. */
  readonly batch: boolean
}

/** JSON record storage capability. */
export interface RecordStore<T extends JsonObject = JsonObject> {
  readonly _tag?: 'RecordStore'
  get(key: string): Promise<T | null>
  getMany?(keys: readonly string[]): Promise<readonly (T | null)[]>
  put(key: string, value: T, options?: RecordWriteOptions): Promise<void>
  putMany?(entries: readonly RecordWrite<T>[]): Promise<void>
  create(key: string, value: T, options?: RecordWriteOptions): Promise<boolean>
  delete(key: string): Promise<void>
  deleteMany?(keys: readonly string[]): Promise<void>
  list(prefix: string, options?: RecordListOptions): Promise<RecordPage<T>>
  scan?(prefix: string, options?: Omit<RecordListOptions, 'cursor'>): AsyncIterable<RecordEntry<T>>
  watch?(prefix: string, callback: (event: RecordEvent<T>) => void): () => void
  capabilities(): RecordStoreCapabilities
}

/** Sparse vector representation used by sparse and hybrid vector search. */
export interface SparseVector {
  readonly indices: readonly number[]
  readonly values: readonly number[]
}

/** Dense vector search query. */
export interface DenseVectorSearchQuery {
  readonly mode: 'dense'
  readonly dense: readonly number[]
  readonly sparse?: never
  readonly fusion?: never
  readonly limit?: number
  readonly threshold?: number
  readonly filter?: ExactFilter
}

/** Sparse vector search query. */
export interface SparseVectorSearchQuery {
  readonly mode: 'sparse'
  readonly sparse: SparseVector
  readonly dense?: never
  readonly fusion?: never
  readonly limit?: number
  readonly threshold?: number
  readonly filter?: ExactFilter
}

/** Hybrid vector search query. */
export interface HybridVectorSearchQuery {
  readonly mode: 'hybrid'
  readonly dense: readonly number[]
  readonly sparse: SparseVector
  readonly fusion?: 'rrf' | 'dbsf'
  readonly limit?: number
  readonly threshold?: number
  readonly filter?: ExactFilter
}

/** Discriminated query shape for dense, sparse, and hybrid vector search. */
export type VectorSearchQuery = DenseVectorSearchQuery | SparseVectorSearchQuery | HybridVectorSearchQuery

/** Vector record stored in a vector index. */
export interface VectorRecord {
  readonly key: string
  readonly dense?: readonly number[]
  readonly sparse?: SparseVector
  readonly metadata?: ExactFilter
}

/** Search result from a vector index. */
export interface VectorHit {
  readonly key: string
  readonly score: number
  readonly metadata?: ExactFilter
}

/** Vector store capability levels. */
export interface VectorStoreCapabilities {
  readonly dense: boolean
  readonly sparse: boolean
  readonly hybrid: boolean
  readonly fusion: readonly ('rrf' | 'dbsf')[]
  readonly filter: 'pre' | 'post' | false
  readonly consistency: 'strong' | 'eventual'
}

/** Vector index capability. */
export interface VectorStore {
  readonly _tag?: 'VectorStore'
  upsert(records: readonly VectorRecord[]): Promise<void>
  delete(keys: readonly string[]): Promise<void>
  search(query: VectorSearchQuery): Promise<readonly VectorHit[]>
  capabilities(): VectorStoreCapabilities
}

/** Content accepted by blob stores. */
export type BlobContent = Uint8Array | Blob | ReadableStream<Uint8Array> | string

/** Blob write input. */
export interface BlobPutInput {
  readonly key?: string
  readonly content: BlobContent
  readonly mimeType: string
  readonly metadata?: ExactFilter
}

/** Stable blob reference returned by put and head operations. */
export interface BlobRef {
  readonly uri: string
  readonly size: number
  readonly sha256?: string
}

/** Blob read result. */
export interface BlobReadResult {
  readonly content: BlobContent
  readonly mimeType: string
  readonly size?: number
}

/** Blob store capability levels. */
export interface BlobStoreCapabilities {
  readonly multipart: boolean
  readonly signedUrls: boolean
  readonly maxBytes?: number
}

/** Large payload storage for binaries and oversized generated outputs. */
export interface BlobStore {
  readonly _tag?: 'BlobStore'
  put(input: BlobPutInput): Promise<BlobRef>
  get(uri: string): Promise<BlobReadResult>
  head?(uri: string): Promise<BlobRef | null>
  delete(uri: string): Promise<void>
  createReadUrl?(uri: string, options?: { readonly expiresInMs?: number }): Promise<string>
  capabilities(): BlobStoreCapabilities
}

/** Explicit capability bundle passed to primitives that need storage. */
export interface Storage {
  readonly records: RecordStore
  readonly vectors?: VectorStore
  readonly blobs?: BlobStore
}
