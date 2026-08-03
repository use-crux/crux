/**
 * Store-backed retriever configuration helpers.
 *
 * Query embedding, search planning, active-generation filtering, and hit
 * hydration are owned by the indexed knowledge read-model boundary.
 *
 * @module
 */

import { StorageError, type RecordStore, type SearchStore } from '../storage'
import type { EmbeddingModality } from '../embedding'
import type { IndexedChunkSearchQuery } from '../indexed-knowledge'
import type { guardRetrievedEmbeddingSpace } from '../indexed-knowledge'
import { assertSparseRetrievalInput, type PreparedRetrievalInput } from './query-input'
import type {
  DenseStoreBackedRetrieverConfig,
  RetrievalSearchPlan,
  RetrieveOptions,
  RetrieverHit,
  RetrieverMode,
} from './types'

/** Built-in store-backed retrievers expose composable search. */
export function deriveStoreBackedMode(): Exclude<RetrieverMode, 'custom'> {
  return 'search'
}

/** Resolve the record store from explicit config or a storage bundle. */
export function getRetrieverRecordStore<TModality extends EmbeddingModality>(
  config: Partial<DenseStoreBackedRetrieverConfig<TModality>>,
): RecordStore | undefined {
  return config.records ?? config.storage?.records
}

/** Resolve the search store from explicit config or storage bundle. */
export function getRetrieverSearchStore<TModality extends EmbeddingModality>(
  config: Partial<DenseStoreBackedRetrieverConfig<TModality>>,
): SearchStore | undefined {
  return config.search ?? config.storage?.search
}

/** Embed one prepared input and build the indexed read-model query. */
export async function prepareIndexedChunkSearch<TModality extends EmbeddingModality>(
  config: DenseStoreBackedRetrieverConfig<TModality>,
  prepared: PreparedRetrievalInput<TModality>,
  options: RetrieveOptions,
  guardedSpace: Awaited<ReturnType<typeof guardRetrievedEmbeddingSpace>> | undefined,
): Promise<IndexedChunkSearchQuery> {
  const plan = resolveSearchPlan(config, options)
  if (prepared.media && (plan.sparse || plan.lexical)) {
    throw new StorageError('unsupported_capability', 'Media retrieval supports dense search only.')
  }
  const embeddingSpace = guardedSpace && config.dense && plan.dense
    ? {
        digest: guardedSpace.digest,
        name: config.dense.name,
        dimensions: config.dense.dimensions,
      }
    : undefined
  const common = searchQueryOptions(config, options)

  const lexicalQuery = plan.lexical ? prepared.text : undefined
  if (plan.lexical && lexicalQuery === undefined) {
    throw new StorageError('unsupported_capability', 'Lexical search requires text input.')
  }
  const [dense, sparse] = await Promise.all([
    plan.dense ? config.dense!.embed(prepared.input, { role: 'query' }) : undefined,
    plan.sparse ? embedSparse(config, prepared) : undefined,
  ])
  return {
    legs: {
      ...(dense ? { dense: { vector: dense, ...legOptions(plan.dense) } } : {}),
      ...(sparse ? { sparse: { vector: sparse, ...legOptions(plan.sparse) } } : {}),
      ...(lexicalQuery !== undefined ? { lexical: { query: lexicalQuery, ...legOptions(plan.lexical) } } : {}),
    },
    ...common,
    ...(plan.fusion ? { fusion: plan.fusion } : {}),
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

export function resolveSearchPlan<TModality extends EmbeddingModality>(
  config: DenseStoreBackedRetrieverConfig<TModality>,
  options: RetrieveOptions,
): Required<Pick<RetrievalSearchPlan, never>> & RetrievalSearchPlan {
  const authored = options.search ?? config.plan
  const defaultPlan = defaultSearchPlan(config)
  const plan = authored
    ? {
        dense: authored.dense,
        sparse: authored.sparse,
        lexical: authored.lexical,
        fusion: authored.fusion,
      }
    : defaultPlan

  if (!plan.dense && !plan.sparse && !plan.lexical) {
    throw new StorageError('invalid_value', 'Search retrieval plan requires at least one leg.')
  }
  if (plan.dense && !config.dense) {
    throw new StorageError('unsupported_capability', 'Dense search requires a dense embedding.')
  }
  if (plan.sparse && !config.sparse) {
    throw new StorageError('unsupported_capability', 'Sparse search requires a sparse embedding.')
  }
  return plan
}

function defaultSearchPlan<TModality extends EmbeddingModality>(
  config: DenseStoreBackedRetrieverConfig<TModality>,
): RetrievalSearchPlan {
  if (config.dense && config.sparse) return { dense: true, sparse: true }
  if (config.sparse) return { sparse: true }
  return { dense: true }
}

async function embedSparse<TModality extends EmbeddingModality>(
  config: DenseStoreBackedRetrieverConfig<TModality>,
  prepared: PreparedRetrievalInput<TModality>,
) {
  assertSparseRetrievalInput(prepared, config.sparse!)
  return config.sparse!.embed(prepared.text)
}

function legOptions(value: boolean | { readonly candidates?: number } | undefined): { readonly candidates?: number } {
  return typeof value === 'object' && value.candidates !== undefined ? { candidates: value.candidates } : {}
}

function searchQueryOptions<TModality extends EmbeddingModality>(
  config: DenseStoreBackedRetrieverConfig<TModality>,
  options: RetrieveOptions,
): Pick<IndexedChunkSearchQuery, 'limit' | 'threshold' | 'filter'> {
  return {
    limit: options.limit ?? config.limit,
    threshold: options.threshold ?? config.threshold,
    filter: {
      ...(config.filter ?? {}),
      ...(options.filter ?? {}),
    },
  }
}
