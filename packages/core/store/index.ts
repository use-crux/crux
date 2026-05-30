/**
 * Storage primitives for `@crux/core`.
 *
 * Data, vector, and blob capabilities are separate interfaces. Adapters can
 * implement one capability or bundle several through `storage()`.
 *
 * @module
 */

// Store implementations
export {
  inMemoryBlobStore,
  inMemoryCruxStore,
  inMemoryDataStore,
  inMemoryStorage,
  inMemoryVectorStore,
} from './memory'

// Filter utilities
export { matchesFilter, resolveFieldPath } from './filter'

// Key namespace registry
export { keySpace } from './keyspace'

// Storage bundle helper
export { storage } from './types'

// Types
export type {
  CruxStore,
  DataStore,
  VectorStore,
  BlobStore,
  Storage,
  JsonObject,
  StoreEntry,
  SetOptions,
  ListOptions,
  ListResult,
  ScoredEntry,
  SparseVector,
  VectorSearchOptions,
  VectorSearchQuery,
  VectorRecord,
  VectorHit,
  BlobContent,
  BlobPutInput,
  BlobRef,
  BlobReadResult,
  DataStoreCapabilities,
  VectorStoreCapabilities,
  BlobStoreCapabilities,
  CruxStoreCapabilities,
  StoreEvent,
  StoreSetEvent,
  StoreDeleteEvent,
  EmbedFn,
  ToolConfig,
} from './types'
