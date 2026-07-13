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

/** Phase of data flowing through a retrieval recipe. */
export type StepPhase = 'queries' | 'hits'

/** Built-in and custom retrieval step kinds. */
export type RetrievalStepKind =
  | 'rewrite-query'
  | 'fanout'
  | 'retrieve'
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

/** Runtime context provided to a retrieval step. */
export interface RetrievalStepContext {
  recipeId: string
  sources: ReadonlyArray<{ retrieverId: string; namespace: string; weight?: number }>
  originalQuery: string
  request: RetrieveRequest
  model?: RetrievalModel
  concurrency: number
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
export function markBuiltInRetrievalStep<TStep extends RetrievalStep>(step: TStep): TStep {
  internalStepIds.add(step)
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
