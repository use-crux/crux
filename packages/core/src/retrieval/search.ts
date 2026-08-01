/**
 * Store-backed retriever configuration helpers.
 *
 * Query embedding, vector search, active-generation filtering, and hit
 * hydration are owned by the indexed knowledge read-model boundary.
 *
 * @module
 */

import type { RecordStore, VectorStore } from '../storage'
import type { EmbeddingModality } from '../embedding'
import type { IndexedChunkSearchQuery } from '../indexed-knowledge'
import type { guardRetrievedEmbeddingSpace } from '../indexed-knowledge'
import { assertSparseRetrievalInput, type PreparedRetrievalInput } from './query-input'
import type {
  DenseStoreBackedRetrieverConfig,
  RetrieveOptions,
  RetrieverHit,
  RetrieverMode,
} from './types'

type StoreBackedRetrieverMode = Exclude<RetrieverMode, 'custom'>

/** Derive the default mode from configured embeddings or an explicit search mode. */
export function deriveStoreBackedMode<TModality extends EmbeddingModality>(
  config: Partial<DenseStoreBackedRetrieverConfig<TModality>>,
): StoreBackedRetrieverMode {
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
export function getRetrieverRecordStore<TModality extends EmbeddingModality>(
  config: Partial<DenseStoreBackedRetrieverConfig<TModality>>,
): RecordStore | undefined {
  return config.records ?? config.storage?.records
}

/** Resolve the vector store from explicit config or storage bundle. */
export function getRetrieverVectorStore<TModality extends EmbeddingModality>(
  config: Partial<DenseStoreBackedRetrieverConfig<TModality>>,
): VectorStore | undefined {
  return config.vectors ?? config.storage?.vectors
}

/** Embed one prepared input and build the indexed read-model query. */
export async function prepareIndexedChunkSearch<TModality extends EmbeddingModality>(
  config: DenseStoreBackedRetrieverConfig<TModality>,
  prepared: PreparedRetrievalInput<TModality>,
  options: RetrieveOptions,
  mode: IndexedChunkSearchQuery['mode'],
  guardedSpace: Awaited<ReturnType<typeof guardRetrievedEmbeddingSpace>> | undefined,
): Promise<IndexedChunkSearchQuery> {
  const common = searchQueryOptions(config, options)
  const embeddingSpace = guardedSpace && config.dense
    ? {
        digest: guardedSpace.digest,
        name: config.dense.name,
        dimensions: config.dense.dimensions,
      }
    : undefined

  if (mode === 'dense') {
    return {
      mode,
      dense: await config.dense!.embed(prepared.input, { role: 'query' }),
      ...common,
      ...(embeddingSpace ? { embeddingSpace } : {}),
    }
  }
  assertSparseRetrievalInput(prepared, config.sparse!)
  if (mode === 'sparse') {
    return {
      mode,
      sparse: await config.sparse!.embed(prepared.text),
      ...common,
    }
  }

  const [dense, sparse] = await Promise.all([
    config.dense!.embed(prepared.input, { role: 'query' }),
    config.sparse!.embed(prepared.text),
  ])
  return {
    mode,
    dense,
    sparse,
    ...common,
    fusion: normalizeFusion(options.fusion) ?? config.search?.fusion,
    ...(embeddingSpace ? { embeddingSpace } : {}),
  }
}

/** Mark a dense-only media result without changing the public hit shape. */
export function withMediaQueryProvenance(hit: RetrieverHit, marker: string): RetrieverHit {
  if (hit.kind === 'finding') return hit
  return {
    ...hit,
    provenance: {
      ...hit.provenance,
      matchedQueries: [marker],
    },
  }
}

function searchQueryOptions<TModality extends EmbeddingModality>(
  config: DenseStoreBackedRetrieverConfig<TModality>,
  options: RetrieveOptions,
): Pick<IndexedChunkSearchQuery, 'limit' | 'threshold' | 'filter'> {
  return {
    limit: options.limit ?? config.search?.limit,
    threshold: options.threshold ?? config.search?.threshold,
    filter: {
      ...(config.search?.filter ?? {}),
      ...(options.filter ?? {}),
    },
  }
}

function normalizeFusion(fusion: RetrieveOptions['fusion']): 'rrf' | undefined {
  return fusion?.strategy
}
