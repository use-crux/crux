/**
 * Store-backed retriever configuration helpers.
 *
 * Query embedding, vector search, active-generation filtering, and hit
 * hydration are owned by the indexed knowledge read-model boundary.
 *
 * @module
 */

import type { DataStore, VectorStore } from '../store/types'
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

/** Resolve the data store from explicit config, storage bundle, or legacy store. */
export function getRetrieverDataStore(config: Partial<DenseStoreBackedRetrieverConfig>): DataStore | undefined {
  return config.data ?? config.storage?.data ?? config.store
}

/** Resolve the vector store from explicit config or storage bundle. */
export function getRetrieverVectorStore(config: Partial<DenseStoreBackedRetrieverConfig>): VectorStore | undefined {
  return config.vectors ?? config.storage?.vectors
}
