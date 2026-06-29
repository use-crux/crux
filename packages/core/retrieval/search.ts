/**
 * Store-backed vector search and hit hydration.
 *
 * Embeds queries (dense/sparse/hybrid), runs the configured {@link VectorStore}
 * (or legacy {@link CruxStore} search), hydrates vector hits from the data
 * store, and maps scored entries into {@link RetrieverHit}s.
 *
 * @module
 */

import { matchesFilter } from '../store/filter'
import type { CruxStore, DataStore, ScoredEntry, VectorHit, VectorStore } from '../store/types'
import { isRecord } from './guards'
import type { DenseStoreBackedRetrieverConfig, RetrieverHit, RetrieverMode } from './types'

/** Derive the default mode from the configured embeddings / explicit search mode. */
export function deriveStoreBackedMode(config: Partial<DenseStoreBackedRetrieverConfig>): RetrieverMode {
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

/** Run a dense vector search, hydrating hits from the data store. */
export async function runDenseSearch(
  config: DenseStoreBackedRetrieverConfig,
  query: string,
  options: { limit?: number; threshold?: number; filter?: Record<string, unknown> },
): Promise<ScoredEntry[]> {
  const denseQuery = await config.dense!.embed(query)
  const vectors = getRetrieverVectorStore(config)
  if (vectors) {
    return hydrateVectorHits(config, await vectors.search({ dense: denseQuery, ...options }), options.filter)
  }
  const store = getLegacyRetrieverStore(config)
  return store.vectorSearch
    ? store.vectorSearch(denseQuery, options)
    : store.searchVectors!({ dense: denseQuery, ...options })
}

/** Run a sparse vector search, hydrating hits from the data store. */
export async function runSparseSearch(
  config: DenseStoreBackedRetrieverConfig,
  query: string,
  options: { limit?: number; threshold?: number; filter?: Record<string, unknown> },
): Promise<ScoredEntry[]> {
  const sparseQuery = await config.sparse!.embed(query)
  const vectors = getRetrieverVectorStore(config)
  if (vectors) {
    return hydrateVectorHits(config, await vectors.search({ sparse: sparseQuery, ...options }), options.filter)
  }
  return getLegacyRetrieverStore(config).searchVectors!({ sparse: sparseQuery, ...options })
}

/** Run a hybrid (dense + sparse) vector search with optional fusion. */
export async function runHybridSearch(
  config: DenseStoreBackedRetrieverConfig,
  query: string,
  options: { limit?: number; threshold?: number; filter?: Record<string, unknown>; fusion?: 'rrf' | 'dbsf' },
): Promise<ScoredEntry[]> {
  const [denseQuery, sparseQuery] = await Promise.all([config.dense!.embed(query), config.sparse!.embed(query)])
  const vectorQuery = {
    dense: denseQuery,
    sparse: sparseQuery,
    limit: options.limit,
    threshold: options.threshold,
    filter: options.filter,
    fusion: options.fusion,
  }
  const vectors = getRetrieverVectorStore(config)
  if (vectors) {
    return hydrateVectorHits(config, await vectors.search(vectorQuery), options.filter)
  }
  return getLegacyRetrieverStore(config).searchVectors!(vectorQuery)
}

/** Resolve the data store from explicit config, storage bundle, or legacy store. */
export function getRetrieverDataStore(config: Partial<DenseStoreBackedRetrieverConfig>): DataStore | undefined {
  return config.data ?? config.storage?.data ?? config.store
}

/** Resolve the vector store from explicit config or storage bundle. */
export function getRetrieverVectorStore(config: Partial<DenseStoreBackedRetrieverConfig>): VectorStore | undefined {
  return config.vectors ?? config.storage?.vectors
}

function getLegacyRetrieverStore(config: DenseStoreBackedRetrieverConfig): CruxStore {
  if (!config.store) {
    throw new Error('Retriever requires vectors or a store-backed vector search capability.')
  }
  return config.store
}

async function hydrateVectorHits(
  config: DenseStoreBackedRetrieverConfig,
  hits: readonly VectorHit[],
  filter?: Record<string, unknown>,
): Promise<ScoredEntry[]> {
  const data = getRetrieverDataStore(config)
  if (!data) {
    throw new Error('Retriever with vectors requires data to hydrate vector hits.')
  }

  const entries: ScoredEntry[] = []
  for (const hit of hits) {
    const value = await data.get(hit.key)
    if (!value) continue
    if (filter && !matchesFilter(value, filter)) continue
    entries.push({ key: hit.key, value, score: hit.score })
  }
  return entries
}

/** Map a scored store entry into a {@link RetrieverHit}. */
export function mapScoredEntryToHit(entry: ScoredEntry): RetrieverHit {
  const metadata = isRecord(entry.value.metadata) ? entry.value.metadata : {}
  const parent = isRecord(entry.value.parent)
    ? {
        ...(typeof entry.value.parent.parentId === 'string' ? { parentId: entry.value.parent.parentId } : {}),
        ...(typeof entry.value.parent.key === 'string' ? { key: entry.value.parent.key } : {}),
        ...(typeof entry.value.parent.title === 'string' ? { title: entry.value.parent.title } : {}),
        ...(typeof entry.value.parent.summary === 'string' ? { summary: entry.value.parent.summary } : {}),
      }
    : undefined

  return {
    namespace: String(entry.value.namespace),
    sourceId: String(entry.value.sourceId),
    chunkId: String(entry.value.chunkId),
    content: String(entry.value.content),
    metadata,
    score: entry.score,
    ...(typeof entry.value.sourceUrl === 'string' ? { sourceUrl: entry.value.sourceUrl } : {}),
    ...(typeof entry.value.sourcePath === 'string' ? { sourcePath: entry.value.sourcePath } : {}),
    ...(parent && Object.keys(parent).length > 0 ? { parent } : {}),
    ...(isRecord(entry.value.provenance) ? { provenance: entry.value.provenance } : {}),
  }
}
