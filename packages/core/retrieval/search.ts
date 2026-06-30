/**
 * Store-backed retriever configuration helpers.
 *
 * Query embedding, vector search, active-generation filtering, and hit
 * hydration are owned by the indexed knowledge read-model boundary.
 *
 * @module
 */

import type { RecordStore, VectorStore } from '../storage'
import type { DenseStoreBackedRetrieverConfig, RetrieverMode } from './types'

type StoreBackedRetrieverMode = Exclude<RetrieverMode, 'custom'>

/** Derive the default mode from configured embeddings or an explicit search mode. */
export function deriveStoreBackedMode(config: Partial<DenseStoreBackedRetrieverConfig>): StoreBackedRetrieverMode {
  if (config.search?.mode) {
    return config.search.mode
  }
  if (config.dense && config.sparse) {
    return 'hybrid'
  }
  if (config.sparse) {
    return 'sparse'
  }
  return 'dense'
}

/** Resolve the record store from explicit config or a storage bundle. */
export function getRetrieverRecordStore(config: Partial<DenseStoreBackedRetrieverConfig>): RecordStore | undefined {
  return config.records ?? config.storage?.records
}

/** Resolve the vector store from explicit config or storage bundle. */
export function getRetrieverVectorStore(config: Partial<DenseStoreBackedRetrieverConfig>): VectorStore | undefined {
  return config.vectors ?? config.storage?.vectors
}
