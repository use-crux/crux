/**
 * Runtime engine for named retrieval recipes.
 *
 * @module
 */

import { observe } from '../../observability'
import {
  recipeDefinitionRef,
} from '../../observability/definition-ref'
import { RetrievalRunError } from '../errors'
import { emitRetrievalHitsArtifact } from '../observability'
import type { RetrieveInput, RetrieveOptions, RetrieveRequest } from '../request'
import type { RetrieverHit } from '../types'
import type { RetrievalKnowledgeBinding } from './knowledge-binding'
import type { RetrievalStep, RetrievalStepContext } from './step'
import type { NormalizedRecipeSource } from './source'
import { assertRecipeStepSupportsInput, prepareRecipeRequest, type PreparedRecipeRequest } from './input'
import { normalizePlannedQuery, runRecipeStep, type RecipeState } from './step-runner'
import {
  serializeRecipeError,
  type RecipeTrace,
  type StepTrace,
} from './trace'

let recipeRunCounter = 0

/** Normalized single-source recipe configuration used by the runner. */
export interface RecipeRunnerConfig {
  recipeId: string
  sources: readonly NormalizedRecipeSource[]
  steps: readonly RetrievalStep[]
  model?: RetrievalStepContext['model']
  concurrency: number
  onSourceError: 'fail' | 'skip-with-warning'
  knowledge?: RetrievalKnowledgeBinding
}

/** Execute a recipe and return hits plus a serializable trace. */
export async function runRetrievalRecipe(
  config: RecipeRunnerConfig,
  queryOrRequest: RetrieveInput,
  options: RetrieveOptions = {},
): Promise<{ hits: RetrieverHit[]; trace: RecipeTrace }> {
  const preparedRequest = await prepareRecipeRequest(queryOrRequest, options)
  const { request } = preparedRequest
  const span = observe.openSpan({
    name: `${config.recipeId}.recipe`,
    primitive: 'retrieval.recipe',
    // `retrievalRecipe()` requires `id`, so `recipeId` is always authored.
    definitionRefs: [recipeDefinitionRef(config.recipeId)],
    attributes: {
      recipeId: config.recipeId,
      sourceRetrieverIds: config.sources.map((source) => source.retriever.id),
      namespaceCount: new Set(
        config.sources.map((source) => source.retriever.namespace),
      ).size,
      stepCount: config.steps.length,
      query: preparedRequest.label,
      ...(request.limit !== undefined ? { limit: request.limit } : {}),
      ...(request.threshold !== undefined
        ? { threshold: request.threshold }
        : {}),
      ...(request.filter ? { filter: request.filter } : {}),
      ...(request.mode ? { mode: request.mode } : {}),
      ...(request.fusion ? { fusion: request.fusion.strategy } : {}),
    },
  })
  try {
    return await span.withContext(() =>
      runRetrievalRecipeInternal(config, preparedRequest, span),
    )
  } catch (error) {
    span.error(error)
    throw error
  }
}

async function runRetrievalRecipeInternal(
  config: RecipeRunnerConfig,
  preparedRequest: PreparedRecipeRequest,
  recipeSpan: ReturnType<typeof observe.openSpan>,
): Promise<{ hits: RetrieverHit[]; trace: RecipeTrace }> {
  const { request, safeRequest, label, media } = preparedRequest
  const startedAt = Date.now()
  const traceId = `${startedAt}-retrieval-recipe-${++recipeRunCounter}`
  const steps: StepTrace[] = []
  const errors: ReturnType<typeof serializeRecipeError>[] = []

  let state: RecipeState = {
    phase: 'queries',
    queries: [
      normalizePlannedQuery({ query: label, filter: request.filter }),
    ],
  }

  try {
    for (const step of config.steps) {
      assertRecipeStepSupportsInput(step, media)
      state = await runRecipeStep({
        config,
        request,
        safeRequest,
        queryLabel: label,
        state,
        step,
        traces: steps,
      })
    }

    const hits = state.phase === 'hits' ? [...state.hits] : []
    const trace = buildTrace({
      config,
      traceId,
      startedAt,
      request: safeRequest,
      queryLabel: label,
      steps,
      resultCount: hits.length,
      errors,
    })
    emitRetrievalHitsArtifact(recipeSpan.spanId, {
      retrievalId: trace.id,
      retrieverId: config.sources[0]?.retriever.id ?? '',
      recipeId: config.recipeId,
      namespace: config.sources[0]?.retriever.namespace ?? '',
      mode: 'recipe',
      query: label,
      limit: request.limit,
      fusion: request.fusion?.strategy,
      hits,
    })
    recipeSpan.end({
      attributes: {
        recipeId: config.recipeId,
        resultCount: hits.length,
        durationMs: trace.durationMs,
      },
    })
    return { hits, trace }
  } catch (error) {
    const serialized = serializeRecipeError(error)
    errors.push(serialized)
    const code = error instanceof RetrievalRunError ? error.code : 'step_failed'
    throw new RetrievalRunError(code, serialized.message, {
      cause: error,
      trace: buildTrace({
        config,
        traceId,
        startedAt,
        request: safeRequest,
        queryLabel: label,
        steps,
        resultCount: 0,
        errors,
      }),
    })
  }
}

function buildTrace(args: {
  config: RecipeRunnerConfig
  traceId: string
  startedAt: number
  request: RetrieveRequest
  queryLabel: string
  steps: readonly StepTrace[]
  resultCount: number
  errors: readonly ReturnType<typeof serializeRecipeError>[]
}): RecipeTrace {
  return {
    id: args.traceId,
    recipeId: args.config.recipeId,
    retrieverId: args.config.sources[0]?.retriever.id ?? '',
    startedAt: args.startedAt,
    durationMs: Date.now() - args.startedAt,
    input: args.request,
    query: args.queryLabel,
    steps: args.steps,
    resultCount: args.resultCount,
    warnings: args.steps.flatMap((step) => step.warnings),
    errors: args.errors,
  }
}
