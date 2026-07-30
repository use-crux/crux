import { indexer } from '../indexing'
import { retriever } from './define-retriever'
import { indexedNamespacePrefix, listIndexedEntries } from '../indexed-knowledge/keys'
import type {
  Corpus,
  CorpusSyncResult,
  CruxChunk,
  CruxDocument,
  CruxIngestLoadResultLike,
  IndexingPipeline,
  IndexResult,
} from '../indexing'
import type { DenseEmbedding, EmbeddingModality, SparseEmbedding } from '../embedding'
import type { ExactFilter, JsonObject, RecordStore, Storage, VectorStore } from '../storage'
import type { ChunkingOptions, PipelineCacheConfig } from '../indexing'
import type { KnowledgeBaseRetrieverConfig } from './knowledge-base'
import type { Retriever } from './types'

/** Documents, chunks, or loader results accepted by `knowledgeBase().index()`. */
export type KnowledgeBaseIndexInput =
  | readonly KnowledgeBaseIndexItem[]
  | AsyncIterable<KnowledgeBaseIndexItem>

/** A single item accepted by `knowledgeBase().index()`. */
export type KnowledgeBaseIndexItem = CruxDocument | CruxChunk | CruxIngestLoadResultLike

/** Deferred source input configured on a knowledge base. */
export type KnowledgeBaseSource =
  | KnowledgeBaseIndexInput
  | (() => KnowledgeBaseIndexInput | Promise<KnowledgeBaseIndexInput>)

/** Result returned by `knowledgeBase().remove()`. */
export interface KnowledgeBaseRemoveResult {
  /** Removed source id. */
  sourceId: string
  /** Number of indexed records removed from the active namespace. */
  deletedCount: number
}

export interface KnowledgeBaseLifecycleState {
  /** Runtime readiness for the lifecycle facade. */
  status: 'ready'
  /** Physical cleanup policy for replaced source generations. */
  retention: 'cleanup' | 'retain-inactive'
  /** Number of sources with active indexed chunks in this namespace. */
  indexedSources: number
  /** Number of active chunks in this namespace. */
  indexedChunks: number
  /** Inactive chunk records retained for inspection/debugging. */
  retainedInactiveChunks: number
  /** Last time lifecycle counters were refreshed by a mutation. */
  lastIndexedAt?: number
}

export interface KnowledgeBaseRuntimeConfig<
  TModality extends EmbeddingModality = 'text',
> {
  /** Stable knowledge base and indexer id. */
  id: string
  /** Structural namespace bound to this handle. */
  namespace: string
  /** Optional source used when indexing without call-site input. */
  source?: KnowledgeBaseSource
  /** Optional corpus source tracker. */
  corpus?: Corpus
  /** Storage bundle used by indexing and retrieval. */
  storage?: Storage
  /** Explicit record store override. */
  records?: RecordStore
  /** Explicit vector store override. */
  vectors?: VectorStore
  /** Dense embedding model for dense or hybrid retrieval. */
  embeddings?: DenseEmbedding<TModality>
  /** Sparse embedding model for sparse or hybrid retrieval. */
  sparseEmbeddings?: SparseEmbedding
  /** Chunking options forwarded to the indexing pipeline. */
  chunking?: ChunkingOptions
  /** Explicit indexing pipeline used for document indexing. */
  pipeline?: IndexingPipeline
  /** Indexing cache configuration. */
  cache?: PipelineCacheConfig
  /** Lifecycle policy for replaced source generations. */
  lifecycle?: { retention?: 'cleanup' | 'retain-inactive' }
}

export interface KnowledgeBaseRuntime<TModality extends EmbeddingModality = EmbeddingModality> {
  readonly sourceKind: 'corpus' | 'direct'
  readonly storage: { records: boolean; vectors: boolean }
  readonly capabilities: {
    dense: boolean
    sparse: boolean
    hybrid: boolean
    delete: boolean
    filter: 'pre' | 'post' | false
  }
  readonly lifecycle: KnowledgeBaseLifecycleState
  index(input?: KnowledgeBaseIndexInput): Promise<IndexResult | CorpusSyncResult>
  reindex(input?: KnowledgeBaseIndexInput): Promise<IndexResult | CorpusSyncResult>
  remove(sourceId: string): Promise<KnowledgeBaseRemoveResult>
  retriever<TFilter extends ExactFilter>(config?: KnowledgeBaseRetrieverConfig<TFilter>): Retriever<TFilter, TModality>
}

/** Create the runtime backing a public `knowledgeBase` facade. */
export function createKnowledgeBaseRuntime<TModality extends EmbeddingModality>(
  config: KnowledgeBaseRuntimeConfig<TModality>,
): KnowledgeBaseRuntime<TModality> {
  const records = config.records ?? config.storage?.records
  const vectors = config.vectors ?? config.storage?.vectors
  const retention = config.lifecycle?.retention ?? 'cleanup'
  const lifecycle: KnowledgeBaseLifecycleState = {
    status: 'ready',
    retention,
    indexedSources: 0,
    indexedChunks: 0,
    retainedInactiveChunks: 0,
  }

  async function index(input?: KnowledgeBaseIndexInput): Promise<IndexResult | CorpusSyncResult> {
    const items = await resolveInput(config.source, input)
    const result = await runIndex(items, false)
    await refreshLifecycleState(lifecycle, config.id, config.namespace, records)
    return result
  }

  async function reindex(input?: KnowledgeBaseIndexInput): Promise<IndexResult | CorpusSyncResult> {
    const items = await resolveInput(config.source, input)
    const result = await runIndex(items, true)
    await refreshLifecycleState(lifecycle, config.id, config.namespace, records)
    return result
  }

  async function runIndex(
    items: readonly KnowledgeBaseIndexItem[],
    completeSourceSet: boolean,
  ): Promise<IndexResult | CorpusSyncResult> {
    if (config.corpus) {
      return config.corpus.sync(items.map(toCorpusInput), {
        chunking: config.chunking,
        sourceSet: completeSourceSet ? 'complete' : 'partial',
        stale: completeSourceSet ? 'delete' : 'keep',
      })
    }

    const index = createIndexer(config, records, vectors)
    if (items.every(isChunk)) {
      if (retention === 'cleanup') await cleanupSources(index, unique(items.map((item) => item.sourceId)))
      return index.indexChunks([...items], { replaceSources: true })
    }

    const documents = items.map(toDocument)
    if (retention === 'cleanup') await cleanupSources(index, unique(documents.map((item) => item.sourceId)))
    return index.indexDocuments(documents, {
      replaceSources: true,
      chunking: config.chunking,
    })
  }

  async function remove(sourceId: string): Promise<KnowledgeBaseRemoveResult> {
    const result = config.corpus
      ? await config.corpus.deleteSource(sourceId)
      : { sourceId, deletedCount: await createIndexer(config, records, vectors).deleteSource(sourceId) }
    await refreshLifecycleState(lifecycle, config.id, config.namespace, records)
    return result
  }

  function createRetriever<TFilter extends ExactFilter>(
    retrieverConfig?: KnowledgeBaseRetrieverConfig<TFilter>,
  ): Retriever<TFilter, TModality> {
    return retriever({
      id: config.id,
      knowledgeBaseId: config.id,
      indexerId: config.id,
      namespace: config.namespace,
      records,
      vectors,
      storage: config.storage,
      dense: config.embeddings,
      sparse: config.sparseEmbeddings,
      search: {
        mode: retrieverConfig?.mode,
        limit: retrieverConfig?.limit,
        threshold: retrieverConfig?.threshold,
        filter: retrieverConfig?.filter,
      },
    }) as Retriever<TFilter, TModality>
  }

  return Object.freeze({
    sourceKind: config.corpus ? 'corpus' : 'direct',
    storage: { records: records !== undefined, vectors: vectors !== undefined },
    capabilities: {
      dense: config.embeddings !== undefined,
      sparse: config.sparseEmbeddings !== undefined,
      hybrid: config.embeddings !== undefined && config.sparseEmbeddings !== undefined,
      delete: true,
      filter: vectors?.capabilities().filter ?? false,
    },
    lifecycle,
    index,
    reindex,
    remove,
    retriever: createRetriever,
  })
}

async function resolveInput(
  source: KnowledgeBaseSource | undefined,
  input: KnowledgeBaseIndexInput | undefined,
): Promise<readonly KnowledgeBaseIndexItem[]> {
  const resolved = input ?? (typeof source === 'function' ? await source() : source)
  if (!resolved) {
    throw new Error('knowledgeBase().index() requires input documents/chunks or a configured source.')
  }
  if (isAsyncIterable(resolved)) {
    const items: KnowledgeBaseIndexItem[] = []
    for await (const item of resolved) items.push(item)
    return items
  }
  return [...resolved]
}

function createIndexer<TModality extends EmbeddingModality>(
  config: KnowledgeBaseRuntimeConfig<TModality>,
  records: RecordStore | undefined,
  vectors: VectorStore | undefined,
) {
  return indexer({
    id: config.id,
    namespace: config.namespace,
    records,
    vectors,
    storage: config.storage,
    dense: config.embeddings,
    sparse: config.sparseEmbeddings,
    pipeline: config.pipeline,
    cache: config.cache,
  })
}

async function cleanupSources(index: ReturnType<typeof indexer>, sourceIds: readonly string[]): Promise<void> {
  await Promise.all(sourceIds.map((sourceId) => index.deleteSource(sourceId)))
}

async function refreshLifecycleState(
  state: KnowledgeBaseLifecycleState,
  indexerId: string,
  namespace: string,
  records: RecordStore | undefined,
): Promise<void> {
  if (!records) return
  const entries = await listIndexedEntries(records, indexedNamespacePrefix(indexerId, namespace))
  const chunks = entries
    .map((entry) => entry.value)
    .filter((value): value is JsonObject => value._cruxRecordType === 'chunk')
  const activeChunks = chunks.filter((value) => value.active === true)
  state.indexedSources = unique(activeChunks.flatMap((value) => (typeof value.sourceId === 'string' ? [value.sourceId] : []))).length
  state.indexedChunks = activeChunks.length
  state.retainedInactiveChunks = chunks.length - activeChunks.length
  state.lastIndexedAt = Date.now()
}

function toDocument(item: KnowledgeBaseIndexItem): CruxDocument {
  if (isChunk(item)) {
    throw new Error('knowledgeBase().index() input cannot mix chunks with documents.')
  }
  if (isLoadResult(item)) {
    if (item.ok) return item.document
    throw new Error(`knowledgeBase().index() cannot index failed load result "${item.sourceId}".`)
  }
  return item
}

function toCorpusInput(item: KnowledgeBaseIndexItem): CruxDocument | CruxIngestLoadResultLike {
  if (isChunk(item)) {
    throw new Error('knowledgeBase({ corpus }).index() accepts documents or loader results, not chunks.')
  }
  return item
}

function isChunk(item: KnowledgeBaseIndexItem): item is CruxChunk {
  return 'chunkId' in item && typeof item.chunkId === 'string' && 'ordinal' in item
}

function isLoadResult(item: KnowledgeBaseIndexItem): item is CruxIngestLoadResultLike {
  return 'ok' in item && typeof item.ok === 'boolean'
}

function isAsyncIterable(value: unknown): value is AsyncIterable<KnowledgeBaseIndexItem> {
  return value !== null && typeof value === 'object' && Symbol.asyncIterator in value
}

function unique(values: readonly string[]): string[] {
  return Array.from(new Set(values))
}
