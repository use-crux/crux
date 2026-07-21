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
  prepareIndexedChunkSearch,
  withMediaQueryProvenance,
} from './search'
import {
  createIndexedKnowledgeStore,
  guardRetrievedEmbeddingSpace,
} from '../indexed-knowledge'
import { indexedChunkKey } from '../indexed-knowledge/keys'
import { indexedChunkToHit } from '../indexed-knowledge/records'
import type { IndexedChunkSearchQuery } from '../indexed-knowledge'
import type { DenseEmbedding, EmbeddingModality } from '../embedding'
import type {
  CustomRetrieverConfig,
  DenseStoreBackedRetrieverConfig,
  RetrieveOptions,
  RetrieveRequest,
  Retriever,
  RetrieverHit,
} from './types'
import type { ExactFilter } from '../storage'
import { retrieveOptions } from './request'
import { assertSparseRetrievalInput, prepareRetrievalInput } from './query-input'
import { normalizeRetrieverHit } from './source'

type StoreBackedRetrieverFactoryConfig<TModality extends EmbeddingModality> =
  Omit<DenseStoreBackedRetrieverConfig<TModality>, 'dense'> & {
    dense?: DenseEmbedding<TModality>
      | (EmbeddingModality extends TModality ? DenseEmbedding<'text'> : never)
  }

type RetrieverFactoryConfig<TModality extends EmbeddingModality> =
  | StoreBackedRetrieverFactoryConfig<TModality>
  | CustomRetrieverConfig

/**
 * Create a retriever from a store-backed or custom configuration.
 *
 * @param config - A {@link DenseStoreBackedRetrieverConfig} or {@link CustomRetrieverConfig}.
 * @returns A frozen {@link Retriever}.
 */
export function retriever(config: CustomRetrieverConfig): Retriever<ExactFilter, 'text'>
export function retriever<const TModality extends EmbeddingModality = 'text'>(
  config: DenseStoreBackedRetrieverConfig<TModality>,
): Retriever<ExactFilter, TModality>
export function retriever(
  config: RetrieverFactoryConfig<EmbeddingModality>,
): Retriever
export function retriever(authoredConfig: unknown): unknown {
  const config = authoredConfig as
    | DenseStoreBackedRetrieverConfig<EmbeddingModality>
    | CustomRetrieverConfig
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

function isCustomConfig<TModality extends EmbeddingModality>(
  config: DenseStoreBackedRetrieverConfig<TModality> | CustomRetrieverConfig,
): config is CustomRetrieverConfig {
  return 'retrieve' in config && typeof config.retrieve === 'function'
}

function validateDenseStoreBackedConfig<TModality extends EmbeddingModality>(
  config: Partial<DenseStoreBackedRetrieverConfig<TModality>>,
): asserts config is DenseStoreBackedRetrieverConfig<TModality> {
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

function createDenseStoreBackedRetriever<TModality extends EmbeddingModality>(
  config: DenseStoreBackedRetrieverConfig<TModality>,
): Retriever<ExactFilter, TModality> {
  const defaultMode = deriveStoreBackedMode(config)
  const recordStore = getRetrieverRecordStore(config)
  const indexerId = config.indexerId ?? config.id
  const records = createIndexedKnowledgeStore({
    indexerId,
    namespace: config.namespace,
    records: recordStore!,
    vectors: getRetrieverVectorStore(config),
  })

  let denseSpaceGuard: ReturnType<typeof guardRetrievedEmbeddingSpace> | undefined
  const guardDenseSpace = () => {
    if (!config.dense) throw new Error('Dense retrieval requires a dense embedding.')
    denseSpaceGuard ??= guardRetrievedEmbeddingSpace({
      records: recordStore!,
      namespace: config.namespace,
      embedding: config.dense,
    })
    return denseSpaceGuard
  }

  const retrieve = async (request: RetrieveRequest<ExactFilter, TModality>): Promise<RetrieverHit[]> => {
    const options = retrieveOptions(request)
    const requestedMode: IndexedChunkSearchQuery['mode'] = options.mode ?? config.search?.mode ?? defaultMode
    const guardedSpace = requestedMode === 'sparse' ? undefined : await guardDenseSpace()
    const prepared = await prepareRetrievalInput(request, config)
    if (requestedMode === 'sparse') assertSparseRetrievalInput(prepared, config.sparse!)
    const mode = requestedMode === 'hybrid' && prepared.media ? 'dense' : requestedMode
    const limit = options.limit ?? config.search?.limit
    const threshold = options.threshold ?? config.search?.threshold
    const filter = {
      ...(config.search?.filter ?? {}),
      ...(options.filter ?? {}),
    }
    const fusion = normalizeFusion(options.fusion) ?? config.search?.fusion

    return runRetrievalOperation({
      retrieverId: config.id,
      knowledgeBaseId: config.knowledgeBaseId,
      namespace: config.namespace,
      mode,
      query: prepared.label,
      limit,
      threshold,
      filter,
      fusion,
      run: async () => {
        const hits = await records.searchChunks(
          await prepareIndexedChunkSearch(config, prepared, options, mode, guardedSpace),
        )
        return prepared.media ? hits.map((hit) => withMediaQueryProvenance(hit, prepared.label)) : [...hits]
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

function normalizeFusion(fusion: RetrieveOptions['fusion']): 'rrf' | undefined {
  if (!fusion) return undefined
  return fusion.strategy
}

function createCustomRetriever(config: CustomRetrieverConfig): Retriever<ExactFilter, 'text'> {
  return createRetrieverEntity({
    id: config.id,
    namespace: config.namespace,
    mode: 'custom',
    retrieve: async (request) => {
      const options = retrieveOptions(request)
      const query = customTextQuery(config.id, request)
      return runRetrievalOperation({
        retrieverId: config.id,
        namespace: config.namespace,
        mode: 'custom',
        query,
        limit: options.limit,
        threshold: options.threshold,
        filter: options.filter,
        fusion: normalizeFusion(options.fusion),
        run: async () => (await config.retrieve(query, options)).map(normalizeRetrieverHit),
      })
    },
    defaultContext: config.context,
    defaultInject: config.inject,
    defaultTools: config.tools,
  })
}

function customTextQuery(retrieverId: string, request: RetrieveRequest<ExactFilter, 'text'>): string {
  if ('query' in request && request.query !== undefined) return request.query
  if (typeof request.input === 'string') return request.input
  if (request.input.type === 'text') return request.input.text
  throw new TypeError(
    `Custom retriever "${retrieverId}" accepts text queries only; media input requires a store-backed dense retriever.`,
  )
}
