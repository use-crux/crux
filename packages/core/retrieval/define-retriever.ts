/**
 * The {@link retriever} factory.
 *
 * Dispatches between a custom retriever (user-supplied `retrieve`) and a
 * store-backed dense/sparse/hybrid retriever, validating the config and wiring
 * search, reranking, instrumentation, and the shared retriever entity.
 *
 * @module
 */

import { applyRerankers, normalizeRerankers } from './reranker'
import { createRetrieverEntity } from './entity'
import { runRetrievalOperation } from './observability'
import {
  deriveStoreBackedMode,
  getRetrieverDataStore,
  getRetrieverVectorStore,
  mapScoredEntryToHit,
  runDenseSearch,
  runHybridSearch,
  runSparseSearch,
} from './search'
import type { CustomRetrieverConfig, DenseStoreBackedRetrieverConfig, Retriever } from './types'

/**
 * Create a retriever from a store-backed or custom configuration.
 *
 * @param config - A {@link DenseStoreBackedRetrieverConfig} or {@link CustomRetrieverConfig}.
 * @returns A frozen {@link Retriever}.
 */
export function retriever(config: DenseStoreBackedRetrieverConfig | CustomRetrieverConfig): Retriever {
  validateBaseConfig(config)

  if (isCustomConfig(config)) {
    return createCustomRetriever(config)
  }

  validateDenseStoreBackedConfig(config)
  return createDenseStoreBackedRetriever(config)
}

function validateBaseConfig(config: { id: string; namespace: string }): void {
  if (!config.id.trim()) {
    throw new Error('Retriever id must be non-empty.')
  }
  if (!config.namespace.trim()) {
    throw new Error('Retriever namespace must be non-empty.')
  }
}

function isCustomConfig(
  config: DenseStoreBackedRetrieverConfig | CustomRetrieverConfig,
): config is CustomRetrieverConfig {
  return 'retrieve' in config && typeof config.retrieve === 'function'
}

function validateDenseStoreBackedConfig(
  config: Partial<DenseStoreBackedRetrieverConfig>,
): asserts config is DenseStoreBackedRetrieverConfig {
  const mode = deriveStoreBackedMode(config)
  const data = getRetrieverDataStore(config)
  const vectors = getRetrieverVectorStore(config)
  const legacyStore = config.store

  if (mode === 'dense') {
    if (!config.dense) {
      throw new Error('Store-backed retriever requires a dense embedding.')
    }
    if (!vectors && !legacyStore?.vectorSearch && !legacyStore?.searchVectors) {
      throw new Error('Dense retriever requires vectors.search(), store.vectorSearch(), or store.searchVectors().')
    }
    if (vectors && !data) {
      throw new Error('Retriever with vectors requires data to hydrate vector hits.')
    }
    return
  }

  if (mode === 'sparse') {
    if (!config.sparse) {
      throw new Error('Sparse retriever requires a sparse embedding.')
    }
    if (!vectors && !legacyStore?.searchVectors) {
      throw new Error('Sparse retriever requires vectors.search() or store.searchVectors().')
    }
    if (vectors && !data) {
      throw new Error('Retriever with vectors requires data to hydrate vector hits.')
    }
    return
  }

  if (!config.dense || !config.sparse) {
    throw new Error('Hybrid retriever requires both dense and sparse embeddings.')
  }
  if (!vectors && !legacyStore?.searchVectors) {
    throw new Error('Hybrid retriever requires vectors.search() or store.searchVectors().')
  }
  if (vectors && !data) {
    throw new Error('Retriever with vectors requires data to hydrate vector hits.')
  }
}

function createDenseStoreBackedRetriever(config: DenseStoreBackedRetrieverConfig): Retriever {
  const defaultMode = deriveStoreBackedMode(config)
  const rerankers = normalizeRerankers(config.rerank)

  const retrieve: Retriever['retrieve'] = async (query, options = {}) => {
    const mode = options.mode ?? config.search?.mode ?? defaultMode
    const limit = options.limit ?? config.search?.limit
    const threshold = options.threshold ?? config.search?.threshold
    const filter = {
      ...(config.search?.filter ?? {}),
      ...(options.filter ?? {}),
      namespace: config.namespace,
      _cruxRecordType: 'chunk',
      active: true,
    }
    const fusion = options.fusion ?? config.search?.fusion

    return runRetrievalOperation({
      retrieverId: config.id,
      namespace: config.namespace,
      mode,
      query,
      limit,
      threshold,
      filter,
      fusion,
      run: async () => {
        const results =
          mode === 'dense'
            ? await runDenseSearch(config, query, { limit, threshold, filter })
            : mode === 'sparse'
              ? await runSparseSearch(config, query, { limit, threshold, filter })
              : await runHybridSearch(config, query, { limit, threshold, filter, fusion })

        const hits = results.map(mapScoredEntryToHit)
        return applyRerankers(rerankers, {
          retrieverId: config.id,
          namespace: config.namespace,
          mode,
          query,
          hits,
        })
      },
    })
  }

  return createRetrieverEntity({
    id: config.id,
    namespace: config.namespace,
    mode: defaultMode,
    retrieve,
    defaultContext: config.context,
    defaultInject: config.inject,
    defaultTools: config.tools,
  })
}

function createCustomRetriever(config: CustomRetrieverConfig): Retriever {
  const rerankers = normalizeRerankers(config.rerank)
  return createRetrieverEntity({
    id: config.id,
    namespace: config.namespace,
    mode: 'custom',
    retrieve: (query, options = {}) =>
      runRetrievalOperation({
        retrieverId: config.id,
        namespace: config.namespace,
        mode: 'custom',
        query,
        limit: options.limit,
        threshold: options.threshold,
        filter: options.filter,
        fusion: options.fusion,
        run: async () =>
          applyRerankers(rerankers, {
            retrieverId: config.id,
            namespace: config.namespace,
            mode: 'custom',
            query,
            hits: await config.retrieve(query, options),
          }),
      }),
    defaultContext: config.context,
    defaultInject: config.inject,
    defaultTools: config.tools,
  })
}
