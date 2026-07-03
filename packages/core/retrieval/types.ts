/**
 * Type contracts for the retrieval domain.
 *
 * Covers retriever hits and options, rerankers, the multi-stage pipeline
 * (planned queries, stage inputs, traces), the {@link Retriever} /
 * {@link RetrievalPipeline} instances, and the generated tool name mapping.
 * Config types for the store-backed and custom retrievers are internal.
 *
 * @module
 */

import type { z } from 'zod'
import type { DenseEmbedding, SparseEmbedding } from '../embedding'
import type { ExactFilter, RecordStore, Storage, VectorStore } from '../storage'
import type { Context, PromptInjection } from '../prompt/context-types'
import type { ToolDef } from '../types/tool'
import type { QueryableCruxEntity } from '../tools/entity'
import type { RetrieveOptions, RetrieveRequest } from './request'

export type { RetrieveOptions, RetrieveRequest } from './request'

/** How a retriever resolves queries to hits. */
export type RetrieverMode = 'dense' | 'sparse' | 'hybrid' | 'custom'
/** How a retriever injects into a prompt: context text, tools, or both. */
export type RetrievalInjectMode = 'context' | 'tool' | 'both'
/** The built-in retrieval tool names. */
export type RetrievalToolName = 'search' | 'getSource'

/** Configuration for the tools a retriever exposes. */
export interface RetrievalToolConfig {
  enabled?: boolean
  prefix?: boolean | string
  include?: readonly RetrievalToolName[]
}

type DefaultRetrievalToolNames = 'search'
type IncludedRetrievalToolNames<TConfig> = TConfig extends { include: readonly (infer TName)[] }
  ? Extract<TName, RetrievalToolName>
  : DefaultRetrievalToolNames
type PrefixedRetrievalToolName<TPrefix, TName extends RetrievalToolName> = TPrefix extends string
  ? `${TPrefix}${Capitalize<TName>}`
  : TPrefix extends true
    ? string
    : TName

/** The tool set produced by {@link Retriever.asTools}, keyed by resolved tool name. */
export type RetrieverTools<TConfig extends RetrievalToolConfig | undefined = undefined> = {
  [TName in IncludedRetrievalToolNames<TConfig> as PrefixedRetrievalToolName<
    TConfig extends { prefix?: infer TPrefix } ? TPrefix : undefined,
    TName
  >]: ToolDef
}

/** A single scored retrieval result. */
export interface RetrieverHit {
  namespace: string
  sourceId: string
  chunkId: string
  content: string
  metadata: Record<string, unknown>
  score: number
  sourceUrl?: string
  sourcePath?: string
  parent?: {
    parentId?: string
    key?: string
    title?: string
    summary?: string
    content?: string
    metadata?: Record<string, unknown>
  }
  provenance?: Record<string, unknown>
}

/** Input passed to a {@link RetrieverReranker}. */
export interface RerankerInput {
  retrieverId: string
  namespace: string
  mode: RetrieverMode
  query: string
  hits: RetrieverHit[]
}

/** A reranking stage applied to retrieved hits. */
export interface RetrieverReranker {
  readonly _tag: 'Reranker'
  readonly name: string
  rerank(input: RerankerInput): Promise<RetrieverHit[]> | RetrieverHit[]
}

/** Whether a pipeline stage operates on queries or hits. */
export type RetrievalStagePhase = 'query' | 'hits'

/** The kind of work a pipeline stage performs. */
export type RetrievalStageKind =
  | 'query-planner'
  | 'multi-query'
  | 'parent-expand'
  | 'compress'
  | 'diversify'
  | 'decay'
  | 'custom'

/** A planned subquery produced by a query stage. */
export interface PlannedRetrievalQuery<TFilter extends ExactFilter = ExactFilter> {
  query: string
  filter?: TFilter
  weight?: number
  reason?: string
}

/** Input to a query-phase pipeline stage. */
export interface QueryStageInput {
  retrieverId: string
  pipelineId: string
  namespace: string
  query: string
  options: RetrieveOptions
  queries: readonly PlannedRetrievalQuery[]
}

/** Input to a hit-phase pipeline stage. */
export interface HitStageInput {
  retrieverId: string
  pipelineId: string
  namespace: string
  query: string
  options: RetrieveOptions
  hits: readonly RetrieverHit[]
}

/** A redacted preview of a stage's input/output for tracing. */
export interface RetrievalStagePreview {
  queries?: Array<{ query: string; filter?: Record<string, unknown>; reason?: string }>
  hits?: Array<{ sourceId: string; chunkId: string; score: number; contentPreview?: string }>
}

/** A trace record for a single pipeline stage. */
export interface RetrievalStageTrace {
  name: string
  kind: RetrievalStageKind
  phase: RetrievalStagePhase
  status: 'success' | 'error' | 'skipped'
  inputQueryCount?: number
  outputQueryCount?: number
  inputHitCount?: number
  outputHitCount?: number
  durationMs: number
  warningCount?: number
  warnings?: string[]
  error?: string
  preview?: RetrievalStagePreview
}

/** A trace record for a full pipeline run. */
export interface RetrievalPipelineTrace {
  retrievalId: string
  pipelineId: string
  retrieverId: string
  namespace: string
  query: string
  stages: RetrievalStageTrace[]
  resultCount: number
  durationMs: number
}

/** A query stage may return planned queries directly or with warnings. */
export type QueryStageResult =
  | readonly PlannedRetrievalQuery[]
  | {
      queries: readonly PlannedRetrievalQuery[]
      warnings?: string[]
    }

/** A hit stage may return hits directly or with warnings. */
export type HitStageResult =
  | readonly RetrieverHit[]
  | {
      hits: readonly RetrieverHit[]
      warnings?: string[]
    }

/** A query-phase retrieval pipeline stage. */
export interface QueryRetrievalStage {
  readonly _tag: 'RetrievalStage'
  readonly phase: 'query'
  readonly kind: RetrievalStageKind
  readonly name: string
  run(input: QueryStageInput): Promise<QueryStageResult> | QueryStageResult
}

/** A hit-phase retrieval pipeline stage. */
export interface HitRetrievalStage {
  readonly _tag: 'RetrievalStage'
  readonly phase: 'hits'
  readonly kind: RetrievalStageKind
  readonly name: string
  run(input: HitStageInput): Promise<HitStageResult> | HitStageResult
}

/** A retrieval pipeline stage: query- or hit-phase. */
export type RetrievalPipelineStage = QueryRetrievalStage | HitRetrievalStage

/** A retriever: a queryable knowledge source with context/tool/injection adapters. */
export interface Retriever<TFilter extends ExactFilter = ExactFilter> extends QueryableCruxEntity {
  readonly _tag: 'Retriever' | 'RetrievalPipeline'
  readonly id: string
  readonly namespace: string
  readonly mode: RetrieverMode
  retrieve(queryOrRequest: string | RetrieveRequest<TFilter>, options?: RetrieveOptions<TFilter>): Promise<RetrieverHit[]>
  asContext(options?: {
    priority?: number
    query?: string | ((input: Record<string, unknown>) => string)
    limit?: number
    renderContext?: (hits: RetrieverHit[], meta: { query: string; mode: RetrieverMode; namespace: string }) => string
  }): Context<z.ZodType<{}>>
  asTools<const TConfig extends RetrievalToolConfig | undefined = undefined>(options?: TConfig): RetrieverTools<TConfig>
  inject(args: { input: Record<string, unknown>; promptId?: string }): Promise<PromptInjection>
}

/** A retriever wrapped with query/hit transformation stages. */
export interface RetrievalPipeline extends Retriever {
  readonly _tag: 'RetrievalPipeline'
  readonly base: Retriever
  readonly stages: readonly RetrievalPipelineStage[]
  retrieveWithTrace(
    query: string,
    options?: RetrieveOptions,
  ): Promise<{
    hits: RetrieverHit[]
    trace: RetrievalPipelineTrace
  }>
}

/** Defaults for {@link Retriever.asContext}. Internal. */
export interface RetrieverContextConfig {
  priority?: number
  query?: string | ((input: Record<string, unknown>) => string)
  limit?: number
  renderContext?: (hits: RetrieverHit[], meta: { query: string; mode: RetrieverMode; namespace: string }) => string
}

/** Injection defaults for a retriever or pipeline. Internal. */
export interface RetrievalInjectionConfig {
  inject?: RetrievalInjectMode
  tools?: false | RetrievalToolConfig
}

/** Configuration for a store-backed dense/sparse/hybrid retriever. Internal. */
export interface DenseStoreBackedRetrieverConfig {
  id: string
  /** Indexer id used to derive parent/chunk record keys. Defaults to `id`. */
  indexerId?: string
  namespace: string
  records?: RecordStore
  vectors?: VectorStore
  storage?: Storage
  dense?: DenseEmbedding
  sparse?: SparseEmbedding
  rerank?: RetrieverReranker | RetrieverReranker[]
  search?: {
    mode?: 'dense' | 'sparse' | 'hybrid'
    limit?: number
    threshold?: number
    filter?: ExactFilter
    fusion?: 'rrf' | 'dbsf'
  }
  context?: RetrieverContextConfig
  inject?: RetrievalInjectMode
  tools?: false | RetrievalToolConfig
}

/** Configuration for a custom retriever backed by a user-supplied function. Internal. */
export interface CustomRetrieverConfig {
  id: string
  namespace: string
  retrieve: (query: string, options: RetrieveOptions) => Promise<RetrieverHit[]>
  rerank?: RetrieverReranker | RetrieverReranker[]
  context?: RetrieverContextConfig
  inject?: RetrievalInjectMode
  tools?: false | RetrievalToolConfig
}
