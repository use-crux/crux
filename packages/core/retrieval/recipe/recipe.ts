/**
 * `retrievalRecipe()` — named retrieval composition facade.
 *
 * Phase 1 establishes the public handle and type spine. Runtime execution is
 * implemented in later phases over the same interface.
 *
 * @module
 */

import type { Grounding } from '../../citations'
import type { RetrievalModel } from '../model'
import type { RetrievalToolConfig, Retriever, RetrieverHit, RetrieverTools, RetrieveOptions } from '../types'
import { createRetrieverTools } from '../tools'
import { retrievalNotImplemented } from '../errors'
import type { RetrievalStep } from './step'

/** A trace record for a single recipe step. */
export interface StepTrace {
  id: string
  kind: string
  status: 'success' | 'error' | 'skipped'
  durationMs: number
}

/** Trace record for a full recipe run. */
export interface RecipeTrace {
  recipeId: string
  query: string
  steps: readonly StepTrace[]
  resultCount: number
  durationMs: number
}

/** Configuration for `retrievalRecipe()`. */
export interface RetrievalRecipeConfig<TSteps extends readonly RetrievalStep[] = readonly RetrievalStep[]> {
  id: string
  retriever: Retriever | readonly [Retriever, ...Retriever[]] | ReadonlyArray<{ retriever: Retriever; weight?: number }>
  steps: TSteps
  model?: RetrievalModel
  concurrency?: number
  onSourceError?: 'fail' | 'skip-with-warning'
}

/** Named, inspectable retrieval composition. */
export interface RetrievalRecipe {
  readonly _tag: 'RetrievalRecipe'
  readonly id: string
  run(input: string, options?: RetrieveOptions): Promise<readonly RetrieverHit[]>
  retrieve(query: string, options?: RetrieveOptions): Promise<RetrieverHit[]>
  retrieveWithTrace(
    query: string,
    options?: RetrieveOptions,
  ): Promise<{ hits: RetrieverHit[]; trace: RecipeTrace }>
  asRetriever(): Retriever
  asTools<const TConfig extends RetrievalToolConfig | undefined = undefined>(config?: TConfig): RetrieverTools<TConfig>
  asGrounding(config?: unknown): Grounding
  inspect(): { id: string; stepCount: number; retrieverIds: readonly string[] }
}

/** Create a named retrieval recipe. */
export function retrievalRecipe<const TSteps extends readonly RetrievalStep[]>(
  config: RetrievalRecipeConfig<TSteps>,
): RetrievalRecipe {
  const retrievers = normalizeRetrievers(config.retriever)
  const recipeRetriever = createRecipeRetriever(config.id, retrievers[0])

  return Object.freeze({
    _tag: 'RetrievalRecipe' as const,
    id: config.id,
    run: () => retrievalNotImplemented('phase 3a', `retrievalRecipe("${config.id}").run()`),
    retrieve: () => retrievalNotImplemented('phase 3a', `retrievalRecipe("${config.id}").retrieve()`),
    retrieveWithTrace: () => retrievalNotImplemented('phase 3a', `retrievalRecipe("${config.id}").retrieveWithTrace()`),
    asRetriever: () => recipeRetriever,
    asTools: <const TConfig extends RetrievalToolConfig | undefined = undefined>(
      toolConfig?: TConfig,
    ): RetrieverTools<TConfig> => recipeRetriever.asTools(toolConfig),
    asGrounding: () => createRecipeGrounding(config.id, recipeRetriever),
    inspect: () => ({
      id: config.id,
      stepCount: config.steps.length,
      retrieverIds: retrievers.map((retriever) => retriever.id),
    }),
  })
}

function normalizeRetrievers(
  input: RetrievalRecipeConfig['retriever'],
): readonly Retriever[] {
  if ('id' in input) {
    return [input]
  }
  return input.map((entry) => ('retriever' in entry ? entry.retriever : entry))
}

function createRecipeRetriever(recipeId: string, base: Retriever): Retriever {
  const retrieve = () => retrievalNotImplemented('phase 3a', `retrievalRecipe("${recipeId}").asRetriever().retrieve()`)
  return Object.freeze({
    _tag: 'Retriever' as const,
    id: recipeId,
    namespace: base.namespace,
    mode: base.mode,
    retrieve,
    asContext: () => retrievalNotImplemented('phase 4', `retrievalRecipe("${recipeId}").asRetriever().asContext()`),
    asTools: <const TConfig extends RetrievalToolConfig | undefined = undefined>(
      toolConfig?: TConfig,
    ): RetrieverTools<TConfig> =>
      createRetrieverTools({
        id: recipeId,
        namespace: base.namespace,
        retrieve,
        config: toolConfig,
      }) as RetrieverTools<TConfig>,
    inject: () => retrievalNotImplemented('phase 4', `retrievalRecipe("${recipeId}").asRetriever().inject()`),
  })
}

function createRecipeGrounding(id: string, retriever: Retriever): Grounding {
  return Object.freeze({
    _tag: 'Grounding' as const,
    id: `grounding:${id}`,
    retriever,
    resolve: () => retrievalNotImplemented('phase 4', `retrievalRecipe("${id}").asGrounding().resolve()`),
    inject: () => retrievalNotImplemented('phase 4', `retrievalRecipe("${id}").asGrounding().inject()`),
  })
}
