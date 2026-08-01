/**
 * Retrieval recipe step authoring.
 *
 * Steps are typed by phase so recipes can move from planned queries to hits.
 *
 * @module
 */

import type { ExactFilter } from '../../storage'
import type { RetrieveRequest } from '../request'
import type { RetrieverHit } from '../types'
import type { RetrievalModel } from '../model'
import type { RetrievalCommunitiesBinding, RetrievalKnowledgeBinding } from './knowledge-binding'

/** Phase of data flowing through a retrieval recipe. */
export type StepPhase = 'queries' | 'hits'

/** Built-in and custom retrieval step kinds. */
export type RetrievalStepKind =
  | 'rewrite-query'
  | 'fanout'
  | 'retrieve'
  | 'global-search'
  | 'filter'
  | 'fusion'
  | 'rerank'
  | 'expand-parents'
  | 'compress'
  | 'validate'
  | 'custom'

/** A planned query emitted before retrieval runs. */
export interface PlannedQuery<TFilter extends ExactFilter = ExactFilter> {
  query: string
  filter?: TFilter
  weight?: number
  reason?: string
}

/** Input payload for a step phase. */
export type StepInput<TPhase extends StepPhase> = TPhase extends 'queries'
  ? { queries: readonly PlannedQuery[] }
  : { hits: readonly RetrieverHit[] }

/** Output payload for a step phase. */
export type StepOutput<TPhase extends StepPhase> = StepInput<TPhase> & {
  warnings?: readonly string[]
  sources?: readonly RetrievalSourceTrace[]
  knowledge?: KnowledgeStepTrace
}

/** Per-source retrieve attribution captured on retrieve-step traces. */
export interface RetrievalSourceTrace {
  retrieverId: string
  namespace: string
  status: 'success' | 'error' | 'skipped'
  durationMs: number
  queryCount: number
  hitCount?: number
  weight?: number
  warnings: readonly string[]
  error?: { message: string; name?: string }
}

/** Knowledge-specific receipt payload emitted by connected retrieval steps. */
export interface KnowledgeStepTrace {
  readonly contributor: string
  readonly view?: { readonly id: string; readonly viewRevision: string | null }
  readonly generations: readonly string[]
  readonly coverage: 'exact' | 'compensated' | 'raw-fallback' | 'materialization-wait'
  readonly coverageBasis: string
  readonly scan?: 'all' | 'adaptive'
  readonly detail?: 'overview' | 'detailed'
  readonly available: { readonly reports: number; readonly findings?: number }
  readonly processed: { readonly reports: number; readonly findings?: number }
  readonly adaptive?: {
    readonly threshold: number
    readonly visited: readonly { readonly communityId: string; readonly rating: number }[]
    readonly skipped: readonly { readonly communityId: string; readonly rating: number }[]
  }
  readonly preflight?: {
    readonly reports: number
    readonly batches: number
    readonly inputChars: number
    readonly calls: number
  }
  readonly truncations?: readonly string[]
}

/** Runtime context provided to a retrieval step. */
export interface RetrievalStepContext {
  recipeId: string
  sources: ReadonlyArray<{ retrieverId: string; namespace: string; weight?: number }>
  originalQuery: string
  request: RetrieveRequest
  model?: RetrievalModel
  concurrency: number
  readonly knowledge?: RetrievalKnowledgeBinding
  readonly communities?: RetrievalCommunitiesBinding
}

/** Config for `retrievalStep()`. */
export interface RetrievalStepConfig<TIn extends StepPhase, TOut extends StepPhase> {
  id: string
  kind?: RetrievalStepKind
  phase: { in: TIn; out: TOut }
  model?: RetrievalModel
  needsModel?: boolean
  run(input: StepInput<TIn>, context: RetrievalStepContext): Promise<StepOutput<TOut>> | StepOutput<TOut>
}

/** A typed retrieval recipe step. */
export interface RetrievalStep<TIn extends StepPhase = StepPhase, TOut extends StepPhase = StepPhase> {
  readonly _tag: 'RetrievalStep'
  readonly id: string
  readonly kind: RetrievalStepKind
  readonly phase: { readonly in: TIn; readonly out: TOut }
  readonly model?: RetrievalModel
  readonly needsModel: boolean
  run(input: StepInput<TIn>, context: RetrievalStepContext): Promise<StepOutput<TOut>> | StepOutput<TOut>
}

interface RetrieveStepConfig {
  limit?: number
  threshold?: number
}

const retrieveStepConfigs = new WeakMap<RetrievalStep, RetrieveStepConfig>()
const internalStepIds = new WeakSet<RetrievalStep>()
const rerankerDefinitionIds = new WeakMap<RetrievalStep, string>()
const publicStepConfigs = new WeakMap<RetrievalStep, Readonly<Record<string, unknown>>>()

/** Create a typed retrieval step. */
export function retrievalStep<const TIn extends StepPhase, const TOut extends StepPhase>(
  config: RetrievalStepConfig<TIn, TOut>,
): RetrievalStep<TIn, TOut> {
  return Object.freeze({
    _tag: 'RetrievalStep' as const,
    id: config.id,
    kind: config.kind ?? 'custom',
    phase: Object.freeze({ in: config.phase.in, out: config.phase.out }),
    ...(config.model ? { model: config.model } : {}),
    needsModel: config.needsModel ?? false,
    run: config.run,
  })
}

/** Return whether a step was created by a built-in recipe helper. Internal. */
export function isBuiltInRetrievalStep(step: RetrievalStep): boolean {
  return internalStepIds.has(step)
}

/** Mark a step as created by a built-in recipe helper. Internal. */
export function markBuiltInRetrievalStep<TStep extends RetrievalStep>(
  step: TStep,
  publicConfig?: Readonly<Record<string, unknown>>,
): TStep {
  internalStepIds.add(step)
  if (publicConfig) setRetrievalStepPublicConfig(step, publicConfig)
  return step
}

/** Return retrieve-step options captured by the built-in helper. Internal. */
export function getRetrieveStepConfig(step: RetrievalStep): RetrieveStepConfig | undefined {
  return retrieveStepConfigs.get(step)
}

/** Capture built-in retrieve-step options. Internal. */
export function setRetrieveStepConfig(step: RetrievalStep, config: RetrieveStepConfig): void {
  retrieveStepConfigs.set(step, config)
}

/**
 * Record the authored `rag.reranker` definition id (the engine name) a rerank
 * step invokes, so the runtime `retrieval.step` span can attach a canonical
 * `invoked-reranker` DefinitionRef. Internal.
 */
export function setRerankerDefinitionId(step: RetrievalStep, rerankerId: string): void {
  rerankerDefinitionIds.set(step, rerankerId)
}

/** Return the authored reranker definition id for a rerank step. Internal. */
export function getRerankerDefinitionId(step: RetrievalStep): string | undefined {
  return rerankerDefinitionIds.get(step)
}

/** Capture public options that affect a built-in step. Internal. */
export function setRetrievalStepPublicConfig(
  step: RetrievalStep,
  config: Readonly<Record<string, unknown>>,
): void {
  publicStepConfigs.set(step, config)
}

/** Return public options that affect a built-in step. Internal. */
export function getRetrievalStepPublicConfig(step: RetrievalStep): Readonly<Record<string, unknown>> | undefined {
  return publicStepConfigs.get(step)
}
