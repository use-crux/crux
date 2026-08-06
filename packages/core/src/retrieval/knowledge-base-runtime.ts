import { retriever } from './define-retriever'
import { createConnectedKnowledgeIntegration } from './knowledge-base-connected'
import { recordKnowledgeBaseMutationKnowledgeEvidence, runKnowledgeBaseMutationEffect } from './knowledge-base-effects'
import {
  KnowledgeBaseMetadataValidationError,
  applyKnowledgeBaseCorpusMetadataSchema,
  partitionKnowledgeBaseChunksByMetadata,
  partitionKnowledgeBaseDocumentsByMetadata,
} from './knowledge-base-metadata'
import {
  cleanupKnowledgeBaseSources,
  createKnowledgeBaseIndexer,
  emptyMetadataFailureRun,
  isKnowledgeBaseChunk,
  knowledgeBaseSourceIds,
  refreshKnowledgeBaseLifecycleState,
  resolveKnowledgeBaseInput,
  toKnowledgeBaseCorpusInput,
  toKnowledgeBaseDocument,
  uniqueStrings,
  type KnowledgeBaseIndexRun,
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
import type { ExactFilter, RecordStore, SearchStore, Storage } from '../storage'
import type { ChunkingOptions, PipelineCacheConfig } from '../indexing'
import type { KnowledgeBaseRetrieverConfig } from './knowledge-base'
import type { RetrievalKnowledgeBinding } from './recipe/knowledge-binding'
import type { Retriever } from './types'
import type { KnowledgeViewRegistry } from '../knowledge/view/registry'
import type { CommunitiesConfig } from '../knowledge/communities/communities'
import type { RetainedCommunityRefreshHost } from '../knowledge/communities/retained-refresh'
/** Documents, chunks, or loader results accepted by `knowledgeBase().index()`. */
export type KnowledgeBaseIndexInput = readonly KnowledgeBaseIndexItem[] | AsyncIterable<KnowledgeBaseIndexItem>

/** A single item accepted by `knowledgeBase().index()`. */
export type KnowledgeBaseIndexItem = CruxDocument | CruxChunk | CruxIngestLoadResultLike

/** Deferred source input configured on a knowledge base. */
export type KnowledgeBaseSource = KnowledgeBaseIndexInput | (() => KnowledgeBaseIndexInput | Promise<KnowledgeBaseIndexInput>)

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

export interface KnowledgeBaseRuntimeConfig<TModality extends EmbeddingModality = 'text'> {
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
  /** Explicit search store override. */
  search?: SearchStore
  /** Dense embedding model for dense retrieval legs. */
  embeddings?: DenseEmbedding<TModality>
  /** Sparse embedding model for sparse retrieval legs. */
  sparseEmbeddings?: SparseEmbedding
  /** Chunking options forwarded to the indexing pipeline. */
  chunking?: ChunkingOptions
  /** Explicit indexing pipeline used for document indexing. */
  pipeline?: IndexingPipeline
  /** Connected knowledge communities configuration. */
  communities?: CommunitiesConfig
  /** Internal retained refresh host shared with the public communities surface. */
  communityRefreshHost?: RetainedCommunityRefreshHost
  /** Metadata schema used to validate indexed metadata. */
  metadataSchema?: z.ZodType<unknown>
  /** Indexing cache configuration. */
  cache?: PipelineCacheConfig
  /** Lifecycle policy for replaced source generations. */
  lifecycle?: { retention?: 'cleanup' | 'retain-inactive' }
}

export interface KnowledgeBaseRuntime<TModality extends EmbeddingModality = EmbeddingModality> {
  readonly sourceKind: 'corpus' | 'direct'
  readonly storage: { records: boolean; search: boolean }
  readonly capabilities: {
    legs: {
      dense: boolean
      sparse: boolean
      lexical: boolean
    }
    fusion: readonly 'rrf'[]
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
  const search = config.search ?? config.storage?.search
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
    assets: config.storage?.assets,
    indexerId: config.id,
    namespace: config.namespace,
    pipeline: config.pipeline,
    communities: config.communities,
    communityRefreshHost: config.communityRefreshHost,
    retention,
  })

  async function index(input?: KnowledgeBaseIndexInput): Promise<IndexResult | CorpusSyncResult> {
    const items = await resolveKnowledgeBaseInput(config.source, input)
    const { result, failures, indexed, sourceIds } = await runIndex(items, false)
    const knowledge = indexed ? await connected.afterIndex(sourceIds) : undefined
    if (indexed) {
      await refreshKnowledgeBaseLifecycleState(lifecycle, config.id, config.namespace, records)
    }
    if (failures.length > 0) throw new KnowledgeBaseMetadataValidationError(config.id, failures)
    if (!result) throw new Error('knowledgeBase().index() did not produce an index result.')
    recordKnowledgeBaseMutationKnowledgeEvidence(result, knowledge)
    return knowledge ? { ...result, knowledge } : result
  }

  async function reindex(input?: KnowledgeBaseIndexInput): Promise<IndexResult | CorpusSyncResult> {
    const items = await resolveKnowledgeBaseInput(config.source, input)
    const { result, failures, indexed, sourceIds } = await runIndex(items, true)
    const knowledge = indexed ? await connected.afterIndex(sourceIds) : undefined
    if (indexed) {
      await refreshKnowledgeBaseLifecycleState(lifecycle, config.id, config.namespace, records)
    }
    if (failures.length > 0) throw new KnowledgeBaseMetadataValidationError(config.id, failures)
    if (!result) throw new Error('knowledgeBase().reindex() did not produce an index result.')
    recordKnowledgeBaseMutationKnowledgeEvidence(result, knowledge)
    return knowledge ? { ...result, knowledge } : result
  }

  async function runIndex(
    items: readonly KnowledgeBaseIndexItem[],
    completeSourceSet: boolean,
  ): Promise<KnowledgeBaseIndexRun> {
    const corpus = config.corpus
    if (corpus) {
      const prepared = applyKnowledgeBaseCorpusMetadataSchema(
        config.id,
        config.metadataSchema,
        items.map(toKnowledgeBaseCorpusInput),
      )
      const sourceIds = uniqueStrings(prepared.inputs.flatMap(knowledgeBaseSourceIds))
      const result = await runKnowledgeBaseMutationEffect({
        knowledgeBaseId: config.id,
        namespace: config.namespace,
        operation: 'corpus.sync',
        sourceIds,
        nativePrimitive: 'corpus.sync',
        recovery: completeSourceSet ? 'irreversible' : 'unavailable',
      }, () => corpus.sync([...prepared.inputs], {
          chunking: config.chunking,
          sourceSet: completeSourceSet ? 'complete' : 'partial',
          stale: completeSourceSet ? 'delete' : 'keep',
        }))
      return { result, failures: [], indexed: true, sourceIds }
    }

    const index = createKnowledgeBaseIndexer(config, records, search)
    if (items.every(isKnowledgeBaseChunk)) {
      const prepared = partitionKnowledgeBaseChunksByMetadata(config.id, config.metadataSchema, items)
      if (prepared.chunks.length > 0 || prepared.failures.length === 0) {
        const sourceIds = uniqueStrings(prepared.chunks.map((item) => item.sourceId))
        const result = await runKnowledgeBaseMutationEffect({
          knowledgeBaseId: config.id,
          namespace: config.namespace,
          operation: completeSourceSet ? 'reindex' : 'index',
          sourceIds,
          nativePrimitive: 'indexing.pipeline',
        }, async () => {
          if (retention === 'cleanup') await cleanupKnowledgeBaseSources(index, sourceIds)
          return index.indexChunks([...prepared.chunks], { replaceSources: true })
        })
        return { result, failures: prepared.failures, indexed: true, sourceIds }
      }
      return emptyMetadataFailureRun(prepared.failures)
    }

    const documents = items.map(toKnowledgeBaseDocument)
    const prepared = partitionKnowledgeBaseDocumentsByMetadata(config.id, config.metadataSchema, documents)
    if (prepared.documents.length === 0 && prepared.failures.length > 0) {
      return emptyMetadataFailureRun(prepared.failures)
    }
    const sourceIds = uniqueStrings(prepared.documents.map((item) => item.sourceId))
    const result = await runKnowledgeBaseMutationEffect({
      knowledgeBaseId: config.id,
      namespace: config.namespace,
      operation: completeSourceSet ? 'reindex' : 'index',
      sourceIds,
      nativePrimitive: 'indexing.pipeline',
    }, async () => {
      if (retention === 'cleanup') await cleanupKnowledgeBaseSources(index, sourceIds)
      return index.indexDocuments([...prepared.documents], {
        replaceSources: true,
        chunking: config.chunking,
      })
    })
    return { result, failures: prepared.failures, indexed: true, sourceIds }
  }

  async function remove(sourceId: string): Promise<KnowledgeBaseRemoveResult> {
    const result = await runKnowledgeBaseMutationEffect({
      knowledgeBaseId: config.id,
      namespace: config.namespace,
      operation: 'remove',
      sourceIds: [sourceId],
      nativePrimitive: 'indexing.pipeline',
    }, async () => config.corpus
      ? config.corpus.deleteSource(sourceId)
      : { sourceId, deletedCount: await createKnowledgeBaseIndexer(config, records, search).deleteSource(sourceId) })
    await connected.afterRemove(sourceId)
    await refreshKnowledgeBaseLifecycleState(lifecycle, config.id, config.namespace, records)
    return result
  }

  function createRetriever<TFilter extends ExactFilter>(retrieverConfig?: KnowledgeBaseRetrieverConfig<TFilter>): Retriever<TFilter, TModality> {
    return retriever({
      id: config.id,
      knowledgeBaseId: config.id,
      indexerId: config.id,
      namespace: config.namespace,
      records,
      search,
      storage: config.storage,
      dense: config.embeddings,
      sparse: config.sparseEmbeddings,
      limit: retrieverConfig?.limit,
      threshold: retrieverConfig?.threshold,
      filter: retrieverConfig?.filter,
      plan: retrieverConfig?.search,
    }) as Retriever<TFilter, TModality>
  }
  const searchCapabilities = search?.capabilities()

  return Object.freeze({
    sourceKind: config.corpus ? 'corpus' : 'direct',
    storage: { records: records !== undefined, search: search !== undefined },
    capabilities: {
      legs: {
        dense: searchCapabilities?.legs.dense ?? false,
        sparse: searchCapabilities?.legs.sparse ?? false,
        lexical: searchCapabilities?.legs.lexical ?? false,
      },
      fusion: searchCapabilities?.fusion ?? [],
      delete: true,
      filter: searchCapabilities?.filter ?? false,
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
