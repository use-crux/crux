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
import type { DenseEmbedding, EmbeddingModality, SparseEmbedding } from '../embedding'
import type { ExactFilter, RecordStore, SearchLegMatch, SearchStore, Storage } from '../storage'
import type { Context } from '../prompt/context-types'
import type { InternalPromptInjection } from '../prompt/internal-injection'
import type { QueryableCruxEntity } from '../tools/entity'
import type { RetrieveInput, RetrieveOptions, RetrieveRequest } from './request'
import type { RetrievalToolDef } from './tools'
import type { CruxSourceFacts } from '../indexing'
import type { AssetRef } from '../asset'
import type { KnowledgeRef } from '../knowledge/refs'

export type { RetrievalLegOptions, RetrievalSearchPlan, RetrieveInput, RetrieveOptions, RetrieveRequest } from './request'

/** How a retriever resolves queries to hits. */
export type RetrieverMode = 'search' | 'custom'
/** How a retriever injects into a prompt: context text, tools, or both. */
export type RetrievalInjectMode = 'context' | 'tool' | 'both'
/** The built-in retrieval tool names. */
export type RetrievalToolName = 'search' | 'getSource'

/** Configuration for the tools a retriever exposes. */
export interface RetrievalToolConfig {
  enabled?: boolean
  prefix?: boolean | string
  include?: readonly RetrievalToolName[]
  filters?: readonly string[]
  limit?: { default?: number; max?: number }
  threshold?: { default?: number; min?: number }
  getSource?: { visibility?: 'discovered' | 'namespace' }
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
  >]: RetrievalToolDef
}

/** Immutable provenance issued for a global-search finding hit. */
export interface FindingCitation {
  readonly findingTarget: string
  readonly supports: readonly KnowledgeRef[]
  readonly assertionRefs: readonly { readonly assertionId: string }[]
  readonly lineage: {
    readonly viewRevision: string | null
    readonly communityGeneration: string
    readonly reportCommunityId: string
  }
}

/** A chunk-shaped retrieval result. Absence of `kind` means evidence. */
export interface EvidenceHit {
  readonly kind?: 'evidence'
  namespace: string
  /** Structured attribution hydrated from the indexed record. */
  readonly source: RetrieverSource
  chunkId: string
  content: string
  metadata: Record<string, unknown>
  score: number
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

/** A report-derived connected-knowledge finding. */
export interface FindingHit {
  readonly kind: 'finding'
  readonly namespace: string
  readonly content: string
  readonly score: number
  readonly citation: FindingCitation
}

/** A single scored retrieval result. */
export type RetrieverHit = EvidenceHit | FindingHit

/** Safe source attribution returned with a retrieval hit. */
export interface RetrieverSource extends Omit<CruxSourceFacts, 'assetRef'> {
  readonly id: string
  /**
   * Optional reference to original media. Retrieval never hydrates it; call
   * `assetStore.get(hit.source.assetRef)` only when the application needs the original.
   */
  readonly assetRef?: AssetRef
}

/** Structured scoring and transformation history for a retrieval hit. */
export interface HitProvenance {
  rawScore?: number
  matches?: readonly SearchLegMatch[]
  perSource?: Array<{ retrieverId: string; score: number; rank: number; weight?: number }>
  matchedQueries?: string[]
  ranks?: number[]
  fusedScore?: number
  rerankScore?: number
  decay?: { field: string; factor: number }
  compression?: { originalLength: number; compressedLength: number }
}

/** A modality-aware retrieval call retained as bivariant for legacy handle assignment. */
type RetrieverRetrieve<
  TFilter extends ExactFilter,
  TModality extends EmbeddingModality,
> = {
  bivarianceHack(
    queryOrRequest: RetrieveInput<TFilter, TModality>,
    options?: RetrieveOptions<TFilter>,
  ): Promise<RetrieverHit[]>
}['bivarianceHack']

/** A retriever: a queryable knowledge source with context/tool/injection adapters. */
export interface Retriever<
  TFilter extends ExactFilter = ExactFilter,
  TModality extends EmbeddingModality = 'text',
> extends QueryableCruxEntity {
  readonly _tag: 'Retriever'
  readonly id: string
  readonly namespace: string
  readonly mode: RetrieverMode
  readonly retrieve: RetrieverRetrieve<TFilter, TModality>
  asContext(options?: {
    priority?: number
    query?: string | ((input: Record<string, unknown>) => string)
    limit?: number
    renderContext?: (hits: RetrieverHit[], meta: { query: string; mode: RetrieverMode; namespace: string }) => string
    /** Attach retrieval tools to the returned context. Defaults from the configured inject mode. */
    tools?: boolean
  }): Context<z.ZodType<{}>>
  asTools<const TConfig extends RetrievalToolConfig | undefined = undefined>(options?: TConfig): RetrieverTools<TConfig>
  inject(args: { input: Record<string, unknown>; promptId?: string }): Promise<InternalPromptInjection>
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

/** Configuration for a store-backed search retriever. Internal. */
export interface DenseStoreBackedRetrieverConfig<
  TModality extends EmbeddingModality = 'text',
> {
  id: string
  /** Authored knowledge-base owner identity when this retriever was derived from one. @internal */
  knowledgeBaseId?: string
  /** Indexer id used to derive parent/chunk record keys. Defaults to `id`. */
  indexerId?: string
  namespace: string
  records?: RecordStore
  search?: SearchStore
  storage?: Storage
  dense?: DenseEmbedding<TModality>
  sparse?: SparseEmbedding
  limit?: number
  threshold?: number
  filter?: ExactFilter
  plan?: import('./request').RetrievalSearchPlan
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
