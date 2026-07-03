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
import type { Corpus } from '../indexing'
import type { DenseEmbedding, SparseEmbedding } from '../embedding'
import type { RecordStore, Storage, VectorStore } from '../storage'
import type { Grounding } from '../citations'
import type { MetadataFilter } from './request'
import type { RetrievalToolConfig, Retriever, RetrieverHit, RetrieverTools } from './types'
import { createRetrieverTools } from './tools'
import { retrievalNotImplemented } from './errors'

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
  /** Whether lifecycle runtime is wired for this handle. */
  lifecycle: 'phase-stub' | 'ready'
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
  /** Metadata schema used to type retrieval filters. */
  metadataSchema?: TMetadataSchema
  /** Lifecycle policy for inactive generations and vector retention. */
  lifecycle?: { retention?: 'cleanup' | 'retain-inactive' }
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
  index(input?: unknown): Promise<unknown>
  /** Replace the active generation with freshly indexed sources. */
  reindex(input?: unknown): Promise<unknown>
  /** Remove a source from active retrieval immediately. */
  remove(sourceId: string): Promise<unknown>
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
  const namespace = config.id
  return createKnowledgeBaseHandle({ ...config, namespace })
}

function createKnowledgeBaseHandle<const TMetadataSchema extends z.ZodType<unknown> | undefined>(
  config: KnowledgeBaseConfig<TMetadataSchema> & { namespace: string },
): KnowledgeBase<TMetadataSchema> {
  const retriever = createPhaseStubRetriever<KnowledgeBaseFilter<TMetadataSchema>>(config.id, config.namespace)

  const handle: KnowledgeBase<TMetadataSchema> = {
    id: config.id,
    namespace: config.namespace,
    index: () => retrievalNotImplemented('phase 2', `knowledgeBase("${config.id}").index()`),
    reindex: () => retrievalNotImplemented('phase 2', `knowledgeBase("${config.id}").reindex()`),
    remove: () => retrievalNotImplemented('phase 2', `knowledgeBase("${config.id}").remove()`),
    scope: (scopeConfig: KnowledgeBaseScopeConfig) =>
      createKnowledgeBaseHandle({ ...config, namespace: scopeConfig.namespace }),
    retriever: () => retriever,
    recipe: () => retrievalNotImplemented('phase 3a', `knowledgeBase("${config.id}").recipe()`),
    grounding: () => createPhaseStubGrounding(config.id, retriever),
    tools: <const TConfig extends RetrievalToolConfig | undefined = undefined>(
      toolConfig?: TConfig,
    ): RetrieverTools<TConfig> => retriever.asTools(toolConfig),
    inspect: () => ({
      id: config.id,
      namespace: config.namespace,
      lifecycle: 'phase-stub',
    }),
  }
  return Object.freeze(handle)
}

function createPhaseStubRetriever<TFilter extends import('../storage').ExactFilter>(
  id: string,
  namespace: string,
): Retriever<TFilter> {
  const retrieve = () => retrievalNotImplemented('phase 2', `knowledgeBase("${id}").retriever().retrieve()`)
  return Object.freeze({
    _tag: 'Retriever' as const,
    id,
    namespace,
    mode: 'custom' as const,
    retrieve,
    asContext: () => retrievalNotImplemented('phase 4', `knowledgeBase("${id}").retriever().asContext()`),
    asTools: <const TConfig extends RetrievalToolConfig | undefined = undefined>(
      toolConfig?: TConfig,
    ): RetrieverTools<TConfig> =>
      createRetrieverTools({
        id,
        namespace,
        retrieve,
        config: toolConfig,
      }) as RetrieverTools<TConfig>,
    inject: () => retrievalNotImplemented('phase 4', `knowledgeBase("${id}").retriever().inject()`),
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
