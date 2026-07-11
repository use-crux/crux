/**
 * The {@link retriever} factory.
 *
 * Dispatches between a custom retriever (user-supplied `retrieve`) and a
 * store-backed dense/sparse/hybrid retriever, validating the config and wiring
 * search, instrumentation, and the shared retriever entity.
 *
 * @module
 */

import { createRetrieverEntity } from './entity'
import { runRetrievalOperation } from './observability'
import {
  deriveStoreBackedMode,
  getRetrieverRecordStore,
  getRetrieverVectorStore,
} from './search'
import { createIndexedKnowledgeStore } from '../indexed-knowledge'
import { indexedChunkKey } from '../indexed-knowledge/keys'
import { indexedChunkToHit } from '../indexed-knowledge/records'
import type { IndexedChunkSearchQuery } from '../indexed-knowledge'
import type { CustomRetrieverConfig, DenseStoreBackedRetrieverConfig, RetrieveOptions, Retriever, RetrieverHit } from './types'
import { normalizeRetrieverHit } from './source'

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
  const recordStore = getRetrieverRecordStore(config)
  const indexerId = config.indexerId ?? config.id
  const records = createIndexedKnowledgeStore({
    indexerId,
    namespace: config.namespace,
    records: recordStore!,
    vectors: getRetrieverVectorStore(config),
  })

  const retrieve = async (query: string, options: RetrieveOptions = {}): Promise<RetrieverHit[]> => {
    const mode: IndexedChunkSearchQuery['mode'] = options.mode ?? config.search?.mode ?? defaultMode
    const limit = options.limit ?? config.search?.limit
    const threshold = options.threshold ?? config.search?.threshold
    const filter = {
      ...(config.search?.filter ?? {}),
      ...(options.filter ?? {}),
    }
    const fusion = normalizeFusion(options.fusion) ?? config.search?.fusion

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
        return [...(await records.searchChunks(await prepareIndexedChunkSearch(config, query, options, mode)))]
      },
    })
  }

  return createRetrieverEntity({
    id: config.id,
    namespace: config.namespace,
    mode: defaultMode,
    retrieve,
    getSource: async (lookup) => {
      if (lookup.namespace !== config.namespace) return null
      const value = await recordStore!.get(indexedChunkKey(indexerId, config.namespace, lookup.sourceId, lookup.chunkId))
      return indexedChunkToHit({ value: value ?? {}, score: 1 })
    },
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
  const fusion = normalizeFusion(options.fusion) ?? config.search?.fusion

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

function normalizeFusion(fusion: RetrieveOptions['fusion']): 'rrf' | undefined {
  if (!fusion) return undefined
  return fusion.strategy
}

function createCustomRetriever(config: CustomRetrieverConfig): Retriever {
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
        fusion: normalizeFusion(options.fusion),
        run: async () => (await config.retrieve(query, options)).map(normalizeRetrieverHit),
      }),
    defaultContext: config.context,
    defaultInject: config.inject,
    defaultTools: config.tools,
  })
}
