/**
 * Internal indexed knowledge read-model boundary.
 *
 * This module is used by indexing and retrieval internals to share the same
 * persisted chunk/parent record contract without making it a public storage
 * abstraction.
 *
 * @module
 */

export { createIndexedKnowledgeStore } from './store'
export {
  guardIndexedEmbeddingSpace,
  guardRetrievedEmbeddingSpace,
  indexedEmbeddingSpaceKey,
  registerIndexedEmbeddingSpaceWriter,
  releaseIndexedEmbeddingSpaceWriter,
  resolveIndexedEmbeddingSpace,
} from './embedding-space'
export type { IndexedEmbeddingSpaceRecord } from './embedding-space'
export type {
  IndexedChunkSearchQuery,
  IndexedKnowledgeStore,
  IndexedKnowledgeStoreConfig,
  IndexedParentRecord,
  IndexedParentRef,
  ParentExpansionOptions,
  PersistIndexedGenerationInput,
  PersistIndexedGenerationResult,
} from './types'
