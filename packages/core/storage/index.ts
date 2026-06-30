/**
 * Canonical Storage Beta API for Crux.
 *
 * `RecordStore` is for JSON records, `VectorStore` is for dense/sparse/hybrid
 * search, and `BlobStore` is for binary or oversized payloads. Use
 * {@link storage} to bundle capabilities for Crux primitives.
 *
 * @module
 */

export { StorageError } from './errors'
export { storage } from './bundle'
export { inMemoryBlobStore, inMemoryRecordStore, inMemoryStorage, inMemoryVectorStore } from './memory'
export { matchesExactFilter } from './filter'
export { keySpace } from './keyspace'

export type {
  BlobContent,
  BlobPutInput,
  BlobReadResult,
  BlobRef,
  BlobStore,
  BlobStoreCapabilities,
  DenseVectorSearchQuery,
  ExactFilter,
  FilterValue,
  HybridVectorSearchQuery,
  JsonObject,
  JsonPrimitive,
  JsonValue,
  RecordEntry,
  RecordEvent,
  RecordListOptions,
  RecordPage,
  RecordStore,
  RecordStoreCapabilities,
  RecordWrite,
  RecordWriteOptions,
  SparseVector,
  SparseVectorSearchQuery,
  Storage,
  VectorHit,
  VectorRecord,
  VectorSearchQuery,
  VectorStore,
  VectorStoreCapabilities,
} from './types'
export type { StorageErrorCode, StorageErrorOptions } from './errors'
