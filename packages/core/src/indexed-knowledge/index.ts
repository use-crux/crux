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
