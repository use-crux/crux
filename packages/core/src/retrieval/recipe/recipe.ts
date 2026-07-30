/**
 * `retrievalRecipe()` — named retrieval composition facade.
 *
 * A recipe is a named, inspectable composition over one or more retrievers.
 *
 * @module
 */

import { grounding } from '../../citations'
import type { Grounding, GroundingConfig } from '../../citations'
import type { RetrievalModel } from '../model'
import type { EmbeddingModality } from '../../embedding'
import type { ExactFilter } from '../../storage'
import type { RetrievalToolConfig, Retriever, RetrieverHit, RetrieverTools, RetrieveInput, RetrieveOptions } from '../types'
import { createRetrieverTools } from '../tools'
import { RetrievalConfigError, retrievalNotImplemented } from '../errors'
import { normalizeRetrieveRequest } from '../request'
import { runRetrievalRecipe } from './run'
import type { RetrievalKnowledgeBinding } from './knowledge-binding'
import { isBuiltInRetrievalStep, type RetrievalStep } from './step'
import { normalizeRecipeSources, type NormalizedRecipeSource, type RetrievalRecipeSourceInput } from './source'
export type { RecipeTrace, StepTrace } from './trace'
export type { RetrievalRecipeSource } from './source'

/** Configuration for `retrievalRecipe()`. */
export interface RetrievalRecipeConfig<TSteps extends readonly RetrievalStep[] = readonly RetrievalStep[]> {
  id: string
  retriever: RetrievalRecipeSourceInput
  steps: TSteps
  model?: RetrievalModel
  concurrency?: number
  onSourceError?: 'fail' | 'skip-with-warning'
}

interface InternalRetrievalRecipeConfig<TSteps extends readonly RetrievalStep[] = readonly RetrievalStep[]>
  extends RetrievalRecipeConfig<TSteps> {
  knowledge?: RetrievalKnowledgeBinding
}

/** Named, inspectable retrieval composition. */
export interface RetrievalRecipe {
  readonly _tag: 'RetrievalRecipe'
  readonly id: string
  run(input: RetrieveInput, options?: RetrieveOptions): Promise<readonly RetrieverHit[]>
  retrieve(query: RetrieveInput, options?: RetrieveOptions): Promise<RetrieverHit[]>
  retrieveWithTrace(
    query: RetrieveInput,
    options?: RetrieveOptions,
  ): Promise<{ hits: RetrieverHit[]; trace: import('./trace').RecipeTrace }>
  asRetriever(): Retriever<ExactFilter, EmbeddingModality> & Retriever
  asTools<const TConfig extends RetrievalToolConfig | undefined = undefined>(config?: TConfig): RetrieverTools<TConfig>
  asGrounding(config?: RetrievalRecipeGroundingConfig): Grounding
  inspect(): { id: string; stepCount: number; retrieverIds: readonly string[] }
}

/** Grounding options for {@link RetrievalRecipe.asGrounding}. */
export type RetrievalRecipeGroundingConfig = Omit<GroundingConfig, 'id' | 'retriever'> & {
  /** Stable grounding id. Defaults to `grounding:<recipe id>`. */
  id?: string
}

/** Create a named retrieval recipe. */
export function retrievalRecipe<const TSteps extends readonly RetrievalStep[]>(
  config: RetrievalRecipeConfig<TSteps>,
): RetrievalRecipe {
  const internalConfig = config as InternalRetrievalRecipeConfig<TSteps>
  const sources = normalizeRecipeSources(config.retriever)
  validateRecipeConfig(config, sources)

  const runnerConfig = {
    recipeId: config.id,
    sources,
    steps: config.steps,
    ...(config.model ? { model: config.model } : {}),
    concurrency: config.concurrency ?? 4,
    onSourceError: config.onSourceError ?? 'fail',
    ...(internalConfig.knowledge ? { knowledge: internalConfig.knowledge } : {}),
  }
  const retrieveWithTrace: RetrievalRecipe['retrieveWithTrace'] = (queryOrRequest, options = {}) =>
    runRetrievalRecipe(runnerConfig, queryOrRequest, options)
  const retrieve: RetrievalRecipe['retrieve'] = async (queryOrRequest, options = {}) => {
    const result = await retrieveWithTrace(queryOrRequest, options)
    return result.hits
  }
  const recipeRetriever = createRecipeRetriever(config.id, sources[0].retriever, retrieve)

  return Object.freeze({
    _tag: 'RetrievalRecipe' as const,
    id: config.id,
    run: retrieve,
    retrieve,
    retrieveWithTrace,
    asRetriever: () => recipeRetriever,
    asTools: <const TConfig extends RetrievalToolConfig | undefined = undefined>(
      toolConfig?: TConfig,
    ): RetrieverTools<TConfig> => recipeRetriever.asTools(toolConfig),
    asGrounding: (groundingConfig?: RetrievalRecipeGroundingConfig) =>
      grounding({
        ...(groundingConfig ?? {}),
        id: groundingConfig?.id ?? `grounding:${config.id}`,
        retriever: recipeRetriever as unknown as Retriever,
      }),
    inspect: () => ({
      id: config.id,
      stepCount: config.steps.length,
      retrieverIds: sources.map((source) => source.retriever.id),
    }),
  })
}

function validateRecipeConfig(config: RetrievalRecipeConfig, sources: readonly NormalizedRecipeSource[]): void {
  if (!config.id.trim()) {
    throw new RetrievalConfigError('invalid_step_order', 'Retrieval recipe id must be non-empty.')
  }
  if (sources.length === 0) {
    throw new RetrievalConfigError('invalid_step_order', 'Retrieval recipe requires at least one retriever.')
  }
  for (const source of sources) {
    if (source.retriever.id === config.id) {
      throw new RetrievalConfigError('recipe_id_conflict', 'Retrieval recipe id must be distinct from retriever id.')
    }
  }
  validateStepOrder(config.steps)
  for (const step of config.steps) {
    if (step.needsModel && !step.model && !config.model) {
      throw new RetrievalConfigError('missing_model', `Retrieval step "${step.id}" requires a model.`)
    }
    if ((step.id === 'retrieve' || step.id === 'fusion') && !isBuiltInRetrievalStep(step)) {
      throw new RetrievalConfigError('reserved_step_id', `Retrieval step id "${step.id}" is reserved.`)
    }
  }
}

function validateStepOrder(steps: readonly RetrievalStep[]): void {
  let current: 'queries' | 'hits' = 'queries'
  for (const step of steps) {
    if (step.phase.in !== current) {
      throw new RetrievalConfigError(
        'invalid_step_order',
        `Retrieval step "${step.id}" expects ${step.phase.in} input but receives ${current}.`,
      )
    }
    current = step.phase.out
  }
}

function createRecipeRetriever(
  recipeId: string,
  base: Retriever<ExactFilter, EmbeddingModality>,
  runRecipe: RetrievalRecipe['retrieve'],
): Retriever<ExactFilter, EmbeddingModality> & Retriever {
  const retrieve: Retriever<ExactFilter, EmbeddingModality>['retrieve'] = async (queryOrRequest, options = {}) => {
    const request = normalizeRetrieveRequest(queryOrRequest, options)
    return runRecipe(request)
  }
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
  }) as unknown as Retriever<ExactFilter, EmbeddingModality> & Retriever
}
