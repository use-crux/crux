/**
 * Type contracts for the retrieval domain.
 *
 * Covers retriever hits and options, the {@link Retriever} contract, and the
 * generated tool name mapping.
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
  provenance?: HitProvenance
}

/** Structured scoring and transformation history for a retrieval hit. */
export interface HitProvenance {
  rawScore?: number
  perSource?: Array<{ retrieverId: string; score: number; rank: number; weight?: number }>
  matchedQueries?: string[]
  ranks?: number[]
  fusedScore?: number
  rerankScore?: number
  decay?: { field: string; factor: number }
  compression?: { originalLength: number; compressedLength: number }
}

/** A retriever: a queryable knowledge source with context/tool/injection adapters. */
export interface Retriever<TFilter extends ExactFilter = ExactFilter> extends QueryableCruxEntity {
  readonly _tag: 'Retriever'
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

/** Defaults for {@link Retriever.asContext}. Internal. */
export interface RetrieverContextConfig {
  priority?: number
  query?: string | ((input: Record<string, unknown>) => string)
  limit?: number
  renderContext?: (hits: RetrieverHit[], meta: { query: string; mode: RetrieverMode; namespace: string }) => string
}

/** Injection defaults for a retriever. Internal. */
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
  context?: RetrieverContextConfig
  inject?: RetrievalInjectMode
  tools?: false | RetrievalToolConfig
}
