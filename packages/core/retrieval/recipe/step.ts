/**
 * Retrieval recipe step authoring.
 *
 * Steps are typed by phase so recipes can move from planned queries to hits
 * without exposing the old anonymous pipeline model.
 *
 * @module
 */

import type { ExactFilter } from '../../storage'
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
}

/** Runtime context provided to a retrieval step. */
export interface RetrievalStepContext {
  recipeId: string
  originalQuery: string
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

/** Create a query rewrite step. Runtime execution arrives in phase 3a. */
export function rewriteQuery(config: { id?: string; model?: RetrievalModel } = {}): RetrievalStep<'queries', 'queries'> {
  return retrievalStep({
    id: config.id ?? 'rewrite-query',
    kind: 'rewrite-query',
    phase: { in: 'queries', out: 'queries' },
    model: config.model,
    needsModel: true,
    run: (input) => input,
  })
}

/** Create a query fanout step. Runtime execution arrives in phase 3a. */
export function fanout(
  config: { id?: string; maxQueries?: number; model?: RetrievalModel } = {},
): RetrievalStep<'queries', 'queries'> {
  return retrievalStep({
    id: config.id ?? 'fanout',
    kind: 'fanout',
    phase: { in: 'queries', out: 'queries' },
    model: config.model,
    needsModel: true,
    run: (input) => input,
  })
}

/** Built-in retrieve step. Runtime execution arrives in phase 3a. */
export function retrieve(config: { id?: string; limit?: number } = {}): RetrievalStep<'queries', 'hits'> {
  return retrievalStep({
    id: config.id ?? 'retrieve',
    kind: 'retrieve',
    phase: { in: 'queries', out: 'hits' },
    run: () => ({ hits: [] }),
  })
}

/** Create a rerank step. Runtime execution arrives in phase 3a. */
export function rerank(
  config: { id?: string; topK?: number; model?: RetrievalModel } = {},
): RetrievalStep<'hits', 'hits'> {
  return retrievalStep({
    id: config.id ?? 'rerank',
    kind: 'rerank',
    phase: { in: 'hits', out: 'hits' },
    model: config.model,
    needsModel: true,
    run: (input) => input,
  })
}

/** Create a parent expansion step. Runtime execution arrives in phase 3a. */
export function expandParents(config: { id?: string } = {}): RetrievalStep<'hits', 'hits'> {
  return retrievalStep({
    id: config.id ?? 'expand-parents',
    kind: 'expand-parents',
    phase: { in: 'hits', out: 'hits' },
    run: (input) => input,
  })
}

/** Create a context compression step. Runtime execution arrives in phase 3a. */
export function compressToBudget(
  config: { id?: string; tokens: number; model?: RetrievalModel },
): RetrievalStep<'hits', 'hits'> {
  return retrievalStep({
    id: config.id ?? 'compress',
    kind: 'compress',
    phase: { in: 'hits', out: 'hits' },
    model: config.model,
    needsModel: true,
    run: (input) => input,
  })
}
