import { indexer } from '../indexing'
import { retriever } from './define-retriever'
import { createConnectedKnowledgeIntegration } from './knowledge-base-connected'
import {
  KnowledgeBaseMetadataValidationError,
  applyKnowledgeBaseCorpusMetadataSchema,
  partitionKnowledgeBaseChunksByMetadata,
  partitionKnowledgeBaseDocumentsByMetadata,
  type KnowledgeBaseMetadataFailure,
} from './knowledge-base-metadata'
import {
  isKnowledgeBaseChunk,
  knowledgeBaseSourceIds,
  refreshKnowledgeBaseLifecycleState,
  resolveKnowledgeBaseInput,
  toKnowledgeBaseCorpusInput,
  toKnowledgeBaseDocument,
  uniqueStrings,
} from './knowledge-base-runtime-utils'
import type { z } from 'zod'
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
import type { ExactFilter, RecordStore, Storage, VectorStore } from '../storage'
import type { ChunkingOptions, PipelineCacheConfig } from '../indexing'
import type { KnowledgeBaseRetrieverConfig } from './knowledge-base'
import type { RetrievalKnowledgeBinding } from './recipe/knowledge-binding'
import type { Retriever } from './types'
import type { KnowledgeViewRegistry } from '../knowledge/view/registry'
import type { CommunitiesConfig } from '../knowledge/communities/communities'

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
  /** Connected knowledge communities configuration. */
  communities?: CommunitiesConfig
  /** Metadata schema used to validate indexed metadata. */
  metadataSchema?: z.ZodType<unknown>
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
  /** Return the connected knowledge view registry. */
  viewRegistry(): KnowledgeViewRegistry
  /** @internal Return recipe-step graph access when records are configured. */
  knowledgeBinding(): RetrievalKnowledgeBinding | undefined
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
  const connected = createConnectedKnowledgeIntegration({
    records,
    indexerId: config.id,
    namespace: config.namespace,
    pipeline: config.pipeline,
    communities: config.communities,
    retention,
  })

  async function index(input?: KnowledgeBaseIndexInput): Promise<IndexResult | CorpusSyncResult> {
    const items = await resolveKnowledgeBaseInput(config.source, input)
    const { result, failures, indexed, sourceIds } = await runIndex(items, false)
    if (indexed) {
      await connected.afterIndex(sourceIds)
      await refreshKnowledgeBaseLifecycleState(lifecycle, config.id, config.namespace, records)
    }
    if (failures.length > 0) throw new KnowledgeBaseMetadataValidationError(config.id, failures)
    if (!result) throw new Error('knowledgeBase().index() did not produce an index result.')
    return result
  }

  async function reindex(input?: KnowledgeBaseIndexInput): Promise<IndexResult | CorpusSyncResult> {
    const items = await resolveKnowledgeBaseInput(config.source, input)
    const { result, failures, indexed, sourceIds } = await runIndex(items, true)
    if (indexed) {
      await connected.afterIndex(sourceIds)
      await refreshKnowledgeBaseLifecycleState(lifecycle, config.id, config.namespace, records)
    }
    if (failures.length > 0) throw new KnowledgeBaseMetadataValidationError(config.id, failures)
    if (!result) throw new Error('knowledgeBase().reindex() did not produce an index result.')
    return result
  }

  async function runIndex(
    items: readonly KnowledgeBaseIndexItem[],
    completeSourceSet: boolean,
  ): Promise<KnowledgeBaseIndexRun> {
    if (config.corpus) {
      const prepared = applyKnowledgeBaseCorpusMetadataSchema(
        config.id,
        config.metadataSchema,
        items.map(toKnowledgeBaseCorpusInput),
      )
      const result = await config.corpus.sync([...prepared.inputs], {
        chunking: config.chunking,
        sourceSet: completeSourceSet ? 'complete' : 'partial',
        stale: completeSourceSet ? 'delete' : 'keep',
      })
      return { result, failures: [], indexed: true, sourceIds: uniqueStrings(prepared.inputs.flatMap(knowledgeBaseSourceIds)) }
    }

    const index = createIndexer(config, records, vectors)
    if (items.every(isKnowledgeBaseChunk)) {
      const prepared = partitionKnowledgeBaseChunksByMetadata(config.id, config.metadataSchema, items)
      if (prepared.chunks.length > 0 || prepared.failures.length === 0) {
        if (retention === 'cleanup') await cleanupSources(index, uniqueStrings(prepared.chunks.map((item) => item.sourceId)))
        const result = await index.indexChunks([...prepared.chunks], { replaceSources: true })
        return { result, failures: prepared.failures, indexed: true, sourceIds: uniqueStrings(prepared.chunks.map((item) => item.sourceId)) }
      }
      return emptyMetadataFailureRun(prepared.failures)
    }

    const documents = items.map(toKnowledgeBaseDocument)
    const prepared = partitionKnowledgeBaseDocumentsByMetadata(config.id, config.metadataSchema, documents)
    if (prepared.documents.length === 0 && prepared.failures.length > 0) {
      return emptyMetadataFailureRun(prepared.failures)
    }
    if (retention === 'cleanup') await cleanupSources(index, uniqueStrings(prepared.documents.map((item) => item.sourceId)))
    const result = await index.indexDocuments([...prepared.documents], {
      replaceSources: true,
      chunking: config.chunking,
    })
    return { result, failures: prepared.failures, indexed: true, sourceIds: uniqueStrings(prepared.documents.map((item) => item.sourceId)) }
  }

  async function remove(sourceId: string): Promise<KnowledgeBaseRemoveResult> {
    const result = config.corpus
      ? await config.corpus.deleteSource(sourceId)
      : { sourceId, deletedCount: await createIndexer(config, records, vectors).deleteSource(sourceId) }
    await connected.afterRemove(sourceId)
    await refreshKnowledgeBaseLifecycleState(lifecycle, config.id, config.namespace, records)
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
    viewRegistry: connected.viewRegistry,
    knowledgeBinding: connected.binding,
  })
}

interface KnowledgeBaseIndexRun {
  readonly result?: IndexResult | CorpusSyncResult
  readonly failures: readonly KnowledgeBaseMetadataFailure[]
  readonly indexed: boolean
  readonly sourceIds?: readonly string[]
}

function emptyMetadataFailureRun(failures: readonly KnowledgeBaseMetadataFailure[]): KnowledgeBaseIndexRun {
  return { failures, indexed: false }
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
