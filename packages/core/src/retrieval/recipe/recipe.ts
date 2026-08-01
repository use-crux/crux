/**
 * `retrievalRecipe()` — named retrieval composition facade.
 *
 * A recipe is a named, inspectable composition over one or more retrievers.
 *
 * @module
 */

import type { z } from 'zod'
import { grounding } from '../../citations'
import type { Grounding, GroundingConfig } from '../../citations'
import { contextWithFamily } from '../../prompt/context'
import { contributor } from '../../prompt/contributor'
import type { ContributorEntry } from '../../prompt/context-types'
import type { InternalPromptInjection } from '../../prompt/internal-injection'
import { KNOWLEDGE_TRACE_METADATA_KEY } from '../../request/receipt/knowledge'
import type { RetrievalModel } from '../model'
import type { EmbeddingModality } from '../../embedding'
import type { ExactFilter } from '../../storage'
import type { RetrievalToolConfig, Retriever, RetrieverHit, RetrieverTools, RetrieveInput, RetrieveOptions } from '../types'
import { createRetrieverTools } from '../tools'
import { RetrievalConfigError, retrievalNotImplemented } from '../errors'
import { promptInputQuery } from '../knowledge-base-context'
import { normalizeRetrieveRequest } from '../request'
import { runRetrievalRecipe } from './run'
import type { RetrievalCommunitiesBinding, RetrievalKnowledgeBinding } from './knowledge-binding'
import { isBuiltInRetrievalStep, type RetrievalStep } from './step'
import { normalizeRecipeSources, type NormalizedRecipeSource, type RetrievalRecipeSourceInput } from './source'
import { fingerprintRetrievalRecipeBehavior } from './bound-identity'
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
  communities?: RetrievalCommunitiesBinding
  fingerprint?: string
}

/** Named, inspectable retrieval composition. */
export interface RetrievalRecipe {
  readonly _tag: 'RetrievalRecipe'
  readonly id: string
  readonly fingerprint: string
  run(input: RetrieveInput, options?: RetrieveOptions): Promise<readonly RetrieverHit[]>
  retrieve(query: RetrieveInput, options?: RetrieveOptions): Promise<RetrieverHit[]>
  retrieveWithTrace(
    query: RetrieveInput,
    options?: RetrieveOptions,
  ): Promise<{ hits: RetrieverHit[]; trace: import('./trace').RecipeTrace }>
  /** Return this recipe as retrieval prompt context. */
  asContext(options?: RetrievalRecipeContextOptions): ContributorEntry<z.ZodType>
  /** Contribute default recipe context when used directly in `use`. */
  inject(args: { input: Record<string, unknown>; promptId?: string }): Promise<InternalPromptInjection>
  asRetriever(): Retriever<ExactFilter, EmbeddingModality> & Retriever
  asTools<const TConfig extends RetrievalToolConfig | undefined = undefined>(config?: TConfig): RetrieverTools<TConfig>
  asGrounding(config?: RetrievalRecipeGroundingConfig): Grounding
  inspect(): { id: string; stepCount: number; retrieverIds: readonly string[] }
}

/** Options for rendering a retrieval recipe as prompt context. */
export interface RetrievalRecipeContextOptions {
  readonly priority?: number
  readonly query?: string | ((input: Record<string, unknown>) => string)
  readonly limit?: number
  readonly renderContext?: (hits: RetrieverHit[], meta: { query: string; recipeId: string; namespace: string }) => string
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
  const fingerprint = internalConfig.fingerprint ?? fingerprintRetrievalRecipeBehavior(config)

  const runnerConfig = {
    recipeId: config.id,
    recipeFingerprint: fingerprint,
    sources,
    steps: config.steps,
    ...(config.model ? { model: config.model } : {}),
    concurrency: config.concurrency ?? 4,
    onSourceError: config.onSourceError ?? 'fail',
    ...(internalConfig.knowledge ? { knowledge: internalConfig.knowledge } : {}),
    ...(internalConfig.communities ? { communities: internalConfig.communities } : {}),
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
    fingerprint,
    run: retrieve,
    retrieve,
    retrieveWithTrace,
    asContext: (options?: RetrievalRecipeContextOptions) =>
      recipeContext(config.id, sources[0].retriever.namespace, retrieveWithTrace, options),
    inject: async (_args: { input: Record<string, unknown>; promptId?: string }): Promise<InternalPromptInjection> => ({
      contexts: [recipeContext(config.id, sources[0].retriever.namespace, retrieveWithTrace)],
    }),
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

function recipeContext(
  recipeId: string,
  namespace: string,
  retrieveWithTrace: RetrievalRecipe['retrieveWithTrace'],
  options: RetrievalRecipeContextOptions = {},
): ContributorEntry<z.ZodType> {
  return contributor({
    id: `retrieval-recipe:${recipeId}`,
    contribute: async ({ input }) => {
      const querySource = options.query ?? promptInputQuery
      const query = typeof querySource === 'function' ? querySource(input) : querySource
      const { hits, trace } = await retrieveWithTrace(query, { limit: options.limit })
      const rendered = (options.renderContext ?? defaultRenderRecipeContext)(
        hits,
        { query, recipeId, namespace },
      )
      return {
        contexts: [contextWithFamily({
          id: `retrieval-recipe-context:${recipeId}`,
          priority: options.priority ?? 50,
          system: rendered,
        }, 'retriever')],
        metadata: { [KNOWLEDGE_TRACE_METADATA_KEY]: [trace] },
      }
    },
  })
}

function defaultRenderRecipeContext(
  hits: readonly RetrieverHit[],
  meta: { query: string; recipeId: string; namespace: string },
): string {
  const lines = hits.map((hit) => hit.kind === 'finding'
    ? `- [${hit.citation.findingTarget}] (score: ${hit.score.toFixed(2)}) ${hit.content}`
    : `- [${hit.source.id}/${hit.chunkId}] (score: ${hit.score.toFixed(2)}) ${hit.content}`)
  return `## Retrieved Context (${meta.namespace}/${meta.recipeId}: ${meta.query})\n${lines.join('\n')}`
}

function validateRecipeConfig(config: RetrievalRecipeConfig, sources: readonly NormalizedRecipeSource[]): void {
  const internalConfig = config as InternalRetrievalRecipeConfig
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
    if (step.kind === 'global-search' && !internalConfig.communities) {
      throw new RetrievalConfigError(
        'missing_model',
        `Retrieval step "${step.id}" requires connected knowledge communities. Configure knowledgeBase({ communities: communities({ model }) }) and run it through knowledgeBase().recipe(...) or view.recipe(...).`,
      )
    }
    if ((step.id === 'retrieve' || step.id === 'fusion') && !isBuiltInRetrievalStep(step)) {
      throw new RetrievalConfigError('reserved_step_id', `Retrieval step id "${step.id}" is reserved.`)
    }
  }
}

function validateStepOrder(steps: readonly RetrievalStep[]): void {
  let current: 'queries' | 'hits' = 'queries'
  let producer: RetrievalStep | undefined
  for (const step of steps) {
    if (isProducerStep(step)) {
      if (producer) {
        throw new RetrievalConfigError(
          'invalid_step_order',
          `Retrieval recipe has more than one producer step: "${producer.id}" and "${step.id}". Use exactly one of retrieve() or globalSearch().`,
        )
      }
      producer = step
    }
    if (step.phase.in !== current) {
      throw new RetrievalConfigError(
        'invalid_step_order',
        `Retrieval step "${step.id}" expects ${step.phase.in} input but receives ${current}.`,
      )
    }
    current = step.phase.out
  }
}

function isProducerStep(step: RetrievalStep): boolean {
  return step.kind === 'retrieve' || step.kind === 'global-search'
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
