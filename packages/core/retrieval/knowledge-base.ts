/**
 * `knowledgeBase()` — high-level Retrieval & RAG beta facade.
 *
 * A knowledge base owns the relationship between source/corpus, indexing,
 * storage, embeddings, and retrieval. Phase 1 establishes the public shape;
 * later phases wire the lifecycle and execution paths into existing indexing
 * and indexed-knowledge primitives.
 *
 * @module
 */

import type { z } from 'zod'
import type { ChunkingOptions, Corpus, IndexResult, PipelineCacheConfig } from '../indexing'
import type { DenseEmbedding, SparseEmbedding } from '../embedding'
import type { RecordStore, Storage, VectorStore } from '../storage'
import type { Grounding } from '../citations'
import type { MetadataFilter } from './request'
import type { RetrievalToolConfig, Retriever, RetrieverTools } from './types'
import { createRetrieverTools } from './tools'
import { retrievalNotImplemented } from './errors'
import { createKnowledgeBaseRuntime } from './knowledge-base-runtime'
import type {
  KnowledgeBaseIndexInput,
  KnowledgeBaseLifecycleState,
  KnowledgeBaseRemoveResult,
  KnowledgeBaseSource,
} from './knowledge-base-runtime'
import type { CorpusSyncResult } from '../indexing'

/** Runtime scoping configuration for a knowledge base handle. */
export interface KnowledgeBaseScopeConfig {
  /** Structural namespace applied to storage keys and retrieval operations. */
  namespace: string
}

/** Inspectable metadata for a knowledge base facade. */
export interface KnowledgeBaseInspection {
  /** Public knowledge base id. */
  id: string
  /** Structural namespace bound to this handle. */
  namespace: string
  /** Source strategy backing lifecycle operations. */
  source: {
    kind: 'corpus' | 'direct'
  }
  /** Configured storage ports available to indexing and retrieval. */
  storage: {
    records: boolean
    vectors: boolean
  }
  /** Retrieval and lifecycle capabilities inferred from configured primitives. */
  capabilities: {
    dense: boolean
    sparse: boolean
    hybrid: boolean
    delete: boolean
    filter: 'pre' | 'post' | false
  }
  /** Current lifecycle status and active index counters. */
  lifecycle: KnowledgeBaseLifecycleState
}

/** Configuration for `knowledgeBase()`. */
export type KnowledgeBaseFilter<TMetadataSchema extends z.ZodType<unknown> | undefined> =
  TMetadataSchema extends z.ZodType<infer TMetadata>
    ? TMetadata extends object
      ? MetadataFilter<TMetadata>
      : never
    : import('../storage').ExactFilter

/** Retriever defaults derived from a knowledge base. */
export interface KnowledgeBaseRetrieverConfig<TFilter extends import('../storage').ExactFilter = import('../storage').ExactFilter> {
  limit?: number
  threshold?: number
  filter?: TFilter
  mode?: 'dense' | 'sparse' | 'hybrid'
}

export interface KnowledgeBaseConfig<TMetadataSchema extends z.ZodType<unknown> | undefined = undefined> {
  /** Stable knowledge base id used for indexer, retriever, and trace identity. */
  id: string
  /** Optional deferred source input used when `index()` is called without arguments. */
  source?: KnowledgeBaseSource
  /** Corpus managed by the indexing subsystem. */
  corpus?: Corpus
  /** Explicit storage bundle used by indexing and retrieval primitives. */
  storage?: Storage
  /** Explicit record store override. */
  records?: RecordStore
  /** Explicit vector store override. */
  vectors?: VectorStore
  /** Dense embedding model used for dense or hybrid search. */
  embeddings?: DenseEmbedding
  /** Sparse embedding model used for sparse or hybrid search. */
  sparseEmbeddings?: SparseEmbedding
  /** Chunking options forwarded to the indexing pipeline. */
  chunking?: ChunkingOptions
  /** Metadata schema used to type retrieval filters. */
  metadataSchema?: TMetadataSchema
  /** Lifecycle policy for inactive generations and vector retention. */
  lifecycle?: { retention?: 'cleanup' | 'retain-inactive' }
  /** Indexing pipeline cache policy. */
  cache?: PipelineCacheConfig
}

/** Tenant-scoped knowledge base handle. */
export type ScopedKnowledgeBase = Omit<KnowledgeBase, 'scope'>

/** Public knowledge base facade. */
export interface KnowledgeBase<TMetadataSchema extends z.ZodType<unknown> | undefined = undefined> {
  /** Stable knowledge base id. */
  readonly id: string
  /** Structural namespace bound to this handle. */
  readonly namespace: string
  /** Index sources into the current generation. */
  index(input?: KnowledgeBaseIndexInput): Promise<IndexResult | CorpusSyncResult>
  /** Replace the active generation with freshly indexed sources. */
  reindex(input?: KnowledgeBaseIndexInput): Promise<IndexResult | CorpusSyncResult>
  /** Remove a source from active retrieval immediately. */
  remove(sourceId: string): Promise<KnowledgeBaseRemoveResult>
  /** Return a tenant-scoped handle with structural key-level isolation. */
  scope(config: KnowledgeBaseScopeConfig): ScopedKnowledgeBase
  /** Return this knowledge base as a retriever. */
  retriever(config?: KnowledgeBaseRetrieverConfig<KnowledgeBaseFilter<TMetadataSchema>>): Retriever<KnowledgeBaseFilter<TMetadataSchema>>
  /** Return this knowledge base as a retrieval recipe. */
  recipe(config?: unknown): unknown
  /** Return this knowledge base as grounded prompt context/tools. */
  grounding(config?: unknown): Grounding
  /** Return this knowledge base as retrieval tools. */
  tools<const TConfig extends RetrievalToolConfig | undefined = undefined>(config?: TConfig): RetrieverTools<TConfig>
  /** Inspect configured parts and lifecycle capabilities. */
  inspect(): KnowledgeBaseInspection
}

/** Create a Retrieval & RAG beta knowledge base facade. */
export function knowledgeBase<const TMetadataSchema extends z.ZodType<unknown> | undefined = undefined>(
  config: KnowledgeBaseConfig<TMetadataSchema>,
): KnowledgeBase<TMetadataSchema> {
  if (config.corpus && config.corpus.id !== config.id) {
    throw new Error(`knowledgeBase("${config.id}") requires corpus.id to match the knowledge base id.`)
  }
  const namespace = config.corpus?.namespace ?? config.id
  return createKnowledgeBaseHandle({ ...config, namespace }, true)
}

function createKnowledgeBaseHandle<const TMetadataSchema extends z.ZodType<unknown> | undefined>(
  config: KnowledgeBaseConfig<TMetadataSchema> & { namespace: string },
  includeScope: boolean,
): KnowledgeBase<TMetadataSchema> {
  const runtime = createKnowledgeBaseRuntime(config)

  const handle = {
    id: config.id,
    namespace: config.namespace,
    index: runtime.index,
    reindex: runtime.reindex,
    remove: runtime.remove,
    scope: (scopeConfig: KnowledgeBaseScopeConfig) =>
      createKnowledgeBaseHandle({ ...config, namespace: scopeConfig.namespace }, false),
    retriever: (retrieverConfig?: KnowledgeBaseRetrieverConfig<KnowledgeBaseFilter<TMetadataSchema>>) =>
      runtime.retriever(retrieverConfig),
    recipe: () => retrievalNotImplemented('phase 3a', `knowledgeBase("${config.id}").recipe()`),
    grounding: () => createPhaseStubGrounding(config.id, createPhaseStubRetriever(config.id, config.namespace)),
    tools: <const TConfig extends RetrievalToolConfig | undefined = undefined>(
      toolConfig?: TConfig,
    ): RetrieverTools<TConfig> => runtime.retriever().asTools(toolConfig),
    inspect: () => ({
      id: config.id,
      namespace: config.namespace,
      source: { kind: runtime.sourceKind },
      storage: runtime.storage,
      capabilities: runtime.capabilities,
      lifecycle: { ...runtime.lifecycle },
    }),
  }
  if (!includeScope) {
    delete (handle as Partial<Pick<KnowledgeBase<TMetadataSchema>, 'scope'>>).scope
  }
  return Object.freeze(handle) as KnowledgeBase<TMetadataSchema>
}

function createPhaseStubRetriever(id: string, namespace: string): Retriever {
  const retrieve = () => retrievalNotImplemented('phase 4', `knowledgeBase("${id}").grounding().retriever.retrieve()`)
  return Object.freeze({
    _tag: 'Retriever' as const,
    id,
    namespace,
    mode: 'custom' as const,
    retrieve,
    asContext: () => retrievalNotImplemented('phase 4', `knowledgeBase("${id}").grounding().retriever.asContext()`),
    asTools: <const TConfig extends RetrievalToolConfig | undefined = undefined>(
      toolConfig?: TConfig,
    ): RetrieverTools<TConfig> =>
      createRetrieverTools({
        id,
        namespace,
        retrieve,
        config: toolConfig,
      }) as RetrieverTools<TConfig>,
    inject: () => retrievalNotImplemented('phase 4', `knowledgeBase("${id}").grounding().retriever.inject()`),
  })
}

function createPhaseStubGrounding(id: string, retriever: Retriever): Grounding {
  return Object.freeze({
    _tag: 'Grounding' as const,
    id: `grounding:${id}`,
    retriever,
    resolve: () => retrievalNotImplemented('phase 4', `knowledgeBase("${id}").grounding().resolve()`),
    inject: () => retrievalNotImplemented('phase 4', `knowledgeBase("${id}").grounding().inject()`),
  })
}
