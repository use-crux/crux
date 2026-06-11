/**
 * Explicit storage capability interfaces for Crux.
 *
 * `DataStore` is for JSON records, `VectorStore` is for dense/sparse/hybrid
 * search, and `BlobStore` is for binary or oversized payloads.
 *
 * @module
 */

export { inMemoryBlobStore, inMemoryDataStore, inMemoryStorage, inMemoryVectorStore } from '../store/memory'
export { storage } from '../store/types'

export type {
  BlobContent,
  BlobPutInput,
  BlobReadResult,
  BlobRef,
  BlobStore,
  BlobStoreCapabilities,
  DataStore,
  DataStoreCapabilities,
  JsonObject,
  ListOptions,
  ListResult,
  SetOptions,
  SparseVector,
  Storage,
  StoreDeleteEvent,
  StoreEntry,
  StoreEvent,
  StoreSetEvent,
  VectorHit,
  VectorRecord,
  VectorSearchOptions,
  VectorSearchQuery,
  VectorStore,
  VectorStoreCapabilities,
} from '../store/types'
