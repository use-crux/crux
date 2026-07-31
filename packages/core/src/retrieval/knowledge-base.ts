/**
 * `knowledgeBase()` — high-level Retrieval & RAG beta facade.
 *
 * A knowledge base owns the relationship between source/corpus, indexing,
 * storage, embeddings, and retrieval. The facade composes the existing
 * indexing, indexed-knowledge, retriever, recipe, and grounding primitives
 * without hiding the lower-level handles.
 *
 * @module
 */

import type { z } from 'zod'
import type { ChunkingOptions, Corpus, IndexingPipeline, IndexResult, PipelineCacheConfig } from '../indexing'
import type { DenseEmbedding, EmbeddingModality, SparseEmbedding } from '../embedding'
import type { RecordStore, Storage, VectorStore } from '../storage'
import { grounding } from '../citations'
import type { Grounding, GroundingConfig } from '../citations'
import type { MetadataFilter } from './request'
import type { RetrievalToolConfig, Retriever, RetrieverTools } from './types'
import { createKnowledgeBaseRuntime } from './knowledge-base-runtime'
import { createKnowledgeBaseView } from './knowledge-base-views'
import { retrievalRecipe, type RetrievalRecipe, type RetrievalRecipeConfig } from './recipe/recipe'
import { retrieve } from './recipe/steps/built-ins'
import type { RetrievalStep } from './recipe/step'
import { deriveBoundRetrievalRecipeIdentity, knowledgeBaseRecipeSurface } from './recipe/bound-identity'
import type {
  KnowledgeBaseIndexInput,
  KnowledgeBaseLifecycleState,
  KnowledgeBaseRemoveResult,
  KnowledgeBaseSource,
} from './knowledge-base-runtime'
import type { CorpusSyncResult } from '../indexing'
import type { KnowledgeBaseViewConfig, KnowledgeView } from '../knowledge/view/view'

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

/** Recipe options for {@link KnowledgeBase.recipe}. */
export type KnowledgeBaseRecipeConfig<TSteps extends readonly RetrievalStep[] = readonly RetrievalStep[]> = Omit<
  RetrievalRecipeConfig<TSteps>,
  'id' | 'retriever'
> & {
  /** Stable recipe id. Anonymous bound recipes derive one from read surface and behavior. */
  id?: string
}

/** Grounding options for {@link KnowledgeBase.grounding}. */
export type KnowledgeBaseGroundingConfig = Omit<GroundingConfig, 'id' | 'retriever'> & {
  /** Stable grounding id. Defaults to `grounding:<knowledge base id>`. */
  id?: string
}

export interface KnowledgeBaseConfig<
  TMetadataSchema extends z.ZodType<unknown> | undefined = undefined,
  TModality extends EmbeddingModality = 'text',
> {
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
  embeddings?: DenseEmbedding<TModality>
  /** Sparse embedding model used for sparse or hybrid search. */
  sparseEmbeddings?: SparseEmbedding
  /** Chunking options forwarded to the indexing pipeline. */
  chunking?: ChunkingOptions
  /** Explicit indexing pipeline used for document indexing. */
  pipeline?: IndexingPipeline
  /** Metadata schema used to type retrieval filters and validate indexed metadata. */
  metadataSchema?: TMetadataSchema
  /** Lifecycle policy for inactive generations and vector retention. */
  lifecycle?: { retention?: 'cleanup' | 'retain-inactive' }
  /** Indexing pipeline cache policy. */
  cache?: PipelineCacheConfig
}

/** Tenant-scoped knowledge base handle. */
export type ScopedKnowledgeBase<
  TMetadataSchema extends z.ZodType<unknown> | undefined = undefined,
  TModality extends EmbeddingModality = 'text',
> = Omit<KnowledgeBase<TMetadataSchema, TModality>, 'scope'>

/** Public knowledge base facade. */
export interface KnowledgeBase<
  TMetadataSchema extends z.ZodType<unknown> | undefined = undefined,
  TModality extends EmbeddingModality = 'text',
> {
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
  scope(config: KnowledgeBaseScopeConfig): ScopedKnowledgeBase<TMetadataSchema, TModality>
  /** Return a live connected knowledge view selected by schema-typed metadata. */
  view(config: KnowledgeBaseViewConfig<TMetadataSchema>): KnowledgeView<TMetadataSchema, TModality>
  /** Return this knowledge base as a retriever. */
  retriever(config?: KnowledgeBaseRetrieverConfig<KnowledgeBaseFilter<TMetadataSchema>>): Retriever<KnowledgeBaseFilter<TMetadataSchema>, TModality>
  /** Return this knowledge base as a retrieval recipe. */
  recipe<const TSteps extends readonly RetrievalStep[] = readonly [ReturnType<typeof retrieve>]>(
    config?: KnowledgeBaseRecipeConfig<TSteps>,
  ): RetrievalRecipe
  /** Return this knowledge base as grounded prompt context/tools. */
  grounding(config?: KnowledgeBaseGroundingConfig): Grounding
  /** Return this knowledge base as retrieval tools. */
  tools<const TConfig extends RetrievalToolConfig | undefined = undefined>(config?: TConfig): RetrieverTools<TConfig>
  /** Inspect configured parts and lifecycle capabilities. */
  inspect(): KnowledgeBaseInspection
}

/** Create a Retrieval & RAG beta knowledge base facade. */
export function knowledgeBase<
  const TMetadataSchema extends z.ZodType<unknown> | undefined = undefined,
  const TModality extends EmbeddingModality = 'text',
>(
  config: KnowledgeBaseConfig<TMetadataSchema, TModality>,
): KnowledgeBase<TMetadataSchema, TModality> {
  if (config.corpus && config.corpus.id !== config.id) {
    throw new Error(`knowledgeBase("${config.id}") requires corpus.id to match the knowledge base id.`)
  }
  if (config.pipeline && config.chunking) {
    throw new Error('knowledgeBase() accepts either pipeline or chunking, not both.')
  }
  const namespace = config.corpus?.namespace ?? config.id
  return createKnowledgeBaseHandle({ ...config, namespace }, true)
}

function createKnowledgeBaseHandle<
  const TMetadataSchema extends z.ZodType<unknown> | undefined,
  const TModality extends EmbeddingModality,
>(
  config: KnowledgeBaseConfig<TMetadataSchema, TModality> & { namespace: string },
  includeScope: boolean,
): KnowledgeBase<TMetadataSchema, TModality> {
  const runtime = createKnowledgeBaseRuntime(config)

  const handle = {
    id: config.id,
    namespace: config.namespace,
    index: runtime.index,
    reindex: runtime.reindex,
    remove: runtime.remove,
    scope: (scopeConfig: KnowledgeBaseScopeConfig) =>
      createKnowledgeBaseHandle({ ...config, namespace: scopeConfig.namespace }, false),
    view: (viewConfig: KnowledgeBaseViewConfig<TMetadataSchema>) =>
      createKnowledgeBaseView({
        id: config.id,
        namespace: config.namespace,
        metadataSchema: config.metadataSchema,
        view: viewConfig,
        records: config.records ?? config.storage?.records,
        registry: runtime.viewRegistry(),
        retriever: runtime.retriever,
        knowledgeBinding: runtime.knowledgeBinding,
      }),
    retriever: (retrieverConfig?: KnowledgeBaseRetrieverConfig<KnowledgeBaseFilter<TMetadataSchema>>) =>
      runtime.retriever(retrieverConfig),
    recipe: <const TSteps extends readonly RetrievalStep[] = readonly [ReturnType<typeof retrieve>]>(
      recipeConfig?: KnowledgeBaseRecipeConfig<TSteps>,
    ): RetrievalRecipe => {
      const knowledge = runtime.knowledgeBinding()
      if (!recipeConfig) {
        const steps = [retrieve()] as const
        const surface = knowledgeBaseRecipeSurface({ knowledgeBaseId: config.id, namespace: config.namespace })
        const identity = deriveBoundRetrievalRecipeIdentity({
          surface,
          steps,
        })
        const defaultRecipeConfig = {
          id: identity.id,
          fingerprint: identity.fingerprint,
          retriever: runtime.retriever(),
          steps,
          ...(knowledge ? { knowledge } : {}),
        }
        return retrievalRecipe(defaultRecipeConfig)
      }
      const identity = recipeConfig.id !== undefined
        ? { id: recipeConfig.id, fingerprint: undefined }
        : deriveBoundRetrievalRecipeIdentity({
            surface: knowledgeBaseRecipeSurface({ knowledgeBaseId: config.id, namespace: config.namespace }),
            steps: recipeConfig.steps,
            ...(recipeConfig.model ? { model: recipeConfig.model } : {}),
            ...(recipeConfig.concurrency !== undefined ? { concurrency: recipeConfig.concurrency } : {}),
            ...(recipeConfig.onSourceError !== undefined ? { onSourceError: recipeConfig.onSourceError } : {}),
          })
      const boundRecipeConfig = {
        ...recipeConfig,
        id: identity.id,
        ...(identity.fingerprint ? { fingerprint: identity.fingerprint } : {}),
        retriever: runtime.retriever() as unknown as Retriever,
        ...(knowledge ? { knowledge } : {}),
      }
      return retrievalRecipe(boundRecipeConfig)
    },
    grounding: (groundingConfig?: KnowledgeBaseGroundingConfig): Grounding =>
      grounding({
        ...(groundingConfig ?? {}),
        id: groundingConfig?.id ?? `grounding:${config.id}`,
        retriever: runtime.retriever() as unknown as Retriever,
      }),
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
    delete (handle as Partial<Pick<KnowledgeBase<TMetadataSchema, TModality>, 'scope'>>).scope
  }
  return Object.freeze(handle) as KnowledgeBase<TMetadataSchema, TModality>
}
