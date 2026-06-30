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
  getRetrieverRecordStore,
  getRetrieverVectorStore,
} from './search'
import { createIndexedKnowledgeStore } from '../indexed-knowledge'
import type { IndexedChunkSearchQuery } from '../indexed-knowledge'
import type { CustomRetrieverConfig, DenseStoreBackedRetrieverConfig, RetrieveOptions, Retriever } from './types'

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
  const records = getRetrieverRecordStore(config)
  const vectors = getRetrieverVectorStore(config)

  if (mode === 'dense') {
    if (!config.dense) {
      throw new Error('Store-backed retriever requires a dense embedding.')
    }
    if (!vectors) {
      throw new Error('Dense retriever requires vectors.search().')
    }
    if (!records) {
      throw new Error('Retriever with vectors requires records to hydrate vector hits.')
    }
    return
  }

  if (mode === 'sparse') {
    if (!config.sparse) {
      throw new Error('Sparse retriever requires a sparse embedding.')
    }
    if (!vectors) {
      throw new Error('Sparse retriever requires vectors.search().')
    }
    if (!records) {
      throw new Error('Retriever with vectors requires records to hydrate vector hits.')
    }
    return
  }

  if (!config.dense || !config.sparse) {
    throw new Error('Hybrid retriever requires both dense and sparse embeddings.')
  }
  if (!vectors) {
    throw new Error('Hybrid retriever requires vectors.search().')
  }
  if (!records) {
    throw new Error('Retriever with vectors requires records to hydrate vector hits.')
  }
}

function createDenseStoreBackedRetriever(config: DenseStoreBackedRetrieverConfig): Retriever {
  const defaultMode = deriveStoreBackedMode(config)
  const rerankers = normalizeRerankers(config.rerank)
  const recordStore = getRetrieverRecordStore(config)
  const records = createIndexedKnowledgeStore({
    indexerId: config.indexerId ?? config.id,
    namespace: config.namespace,
    records: recordStore!,
    vectors: getRetrieverVectorStore(config),
  })

  const retrieve: Retriever['retrieve'] = async (query, options = {}) => {
    const mode: IndexedChunkSearchQuery['mode'] = options.mode ?? config.search?.mode ?? defaultMode
    const limit = options.limit ?? config.search?.limit
    const threshold = options.threshold ?? config.search?.threshold
    const filter = {
      ...(config.search?.filter ?? {}),
      ...(options.filter ?? {}),
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
        const hits = [...(await records.searchChunks(await prepareIndexedChunkSearch(config, query, options, mode)))]
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

async function prepareIndexedChunkSearch(
  config: DenseStoreBackedRetrieverConfig,
  query: string,
  options: RetrieveOptions,
  mode: IndexedChunkSearchQuery['mode'],
): Promise<IndexedChunkSearchQuery> {
  const limit = options.limit ?? config.search?.limit
  const threshold = options.threshold ?? config.search?.threshold
  const filter = {
    ...(config.search?.filter ?? {}),
    ...(options.filter ?? {}),
  }
  const fusion = options.fusion ?? config.search?.fusion

  if (mode === 'dense') {
    return {
      mode,
      dense: await config.dense!.embed(query),
      limit,
      threshold,
      filter,
    }
  }

  if (mode === 'sparse') {
    return {
      mode,
      sparse: await config.sparse!.embed(query),
      limit,
      threshold,
      filter,
    }
  }

  const [dense, sparse] = await Promise.all([config.dense!.embed(query), config.sparse!.embed(query)])
  return {
    mode,
    dense,
    sparse,
    limit,
    threshold,
    filter,
    fusion,
  }
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
