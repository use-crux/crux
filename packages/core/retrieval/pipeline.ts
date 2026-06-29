/**
 * Multi-stage retrieval pipelines.
 *
 * {@link retrievalPipeline} wraps a base retriever with ordered query- and
 * hit-phase stages: query stages refine planned queries, a fan-out stage runs
 * the base retriever per query and fuses results, then hit stages transform the
 * fused hits. Every run produces a {@link RetrievalPipelineTrace}.
 *
 * @module
 */

import { observe } from '../observability'
import { createRetrieverEntity } from './entity'
import { mergeHitGroups, mergeRetrieveOptions } from './fusion'
import { emitRetrievalHitsArtifact } from './observability'
import { normalizeHitStageResult, normalizeQueryStageResult, runPipelineStage } from './pipeline-stage'
import { normalizePlannedQuery, validateStageName } from './stage'
import type {
  HitRetrievalStage,
  HitStageInput,
  PlannedRetrievalQuery,
  RetrievalInjectionConfig,
  RetrievalPipeline,
  RetrievalPipelineStage,
  RetrievalPipelineTrace,
  RetrievalStageTrace,
  Retriever,
  RetrieverContextConfig,
  RetrieverHit,
  RetrieveOptions,
} from './types'

let retrievalPipelineCounter = 0

/**
 * Wrap a base retriever with query/hit transformation stages.
 *
 * @param base - The underlying retriever.
 * @param stages - Ordered stages; query stages must precede hit stages.
 * @param injection - Optional injection + context defaults for the pipeline entity.
 * @returns A frozen {@link RetrievalPipeline}.
 */
export function retrievalPipeline(
  base: Retriever,
  stages: readonly RetrievalPipelineStage[],
  injection?: RetrievalInjectionConfig & { context?: RetrieverContextConfig },
): RetrievalPipeline {
  validatePipelineStages(stages)

  const retrieveWithTrace: RetrievalPipeline['retrieveWithTrace'] = async (query, options = {}) =>
    runRetrievalPipeline({
      base,
      stages,
      query,
      options,
    })

  const retrieve: Retriever['retrieve'] = async (query, options = {}) => {
    const result = await retrieveWithTrace(query, options)
    return result.hits
  }

  const entity = createRetrieverEntity({
    id: base.id,
    namespace: base.namespace,
    mode: base.mode,
    retrieve,
    defaultContext: injection?.context,
    defaultInject: injection?.inject,
    defaultTools: injection?.tools,
  })

  return Object.freeze({
    ...entity,
    _tag: 'RetrievalPipeline' as const,
    base,
    stages: Object.freeze([...stages]),
    retrieve,
    retrieveWithTrace,
  })
}

async function runRetrievalPipeline(args: {
  base: Retriever
  stages: readonly RetrievalPipelineStage[]
  query: string
  options: RetrieveOptions
}): Promise<{ hits: RetrieverHit[]; trace: RetrievalPipelineTrace }> {
  const span = observe.openSpan({
    name: `${args.base.id}.pipeline`,
    family: 'retrieval',
    primitive: 'retrieval.pipeline',
    attributes: {
      retrieverId: args.base.id,
      pipelineId: args.base.id,
      namespace: args.base.namespace,
      query: args.query,
      stageCount: args.stages.length,
      ...(args.options.limit !== undefined ? { limit: args.options.limit } : {}),
      ...(args.options.threshold !== undefined ? { threshold: args.options.threshold } : {}),
      ...(args.options.filter ? { filter: args.options.filter } : {}),
      ...(args.options.mode ? { mode: args.options.mode } : {}),
      ...(args.options.fusion ? { fusion: args.options.fusion } : {}),
    },
  })
  try {
    const result = await span.withContext(() => runRetrievalPipelineInternal(args))
    span.withContext(() =>
      emitRetrievalHitsArtifact(span.spanId, {
        retrievalId: result.trace.retrievalId,
        retrieverId: args.base.id,
        pipelineId: args.base.id,
        namespace: args.base.namespace,
        mode: 'pipeline',
        query: args.query,
        limit: args.options.limit,
        fusion: args.options.fusion,
        stages: result.trace.stages,
        hits: result.hits,
      }),
    )
    span.end({
      retrievalId: result.trace.retrievalId,
      resultCount: result.hits.length,
      durationMs: result.trace.durationMs,
    })
    return result
  } catch (error) {
    span.error(error)
    throw error
  }
}

async function runRetrievalPipelineInternal(args: {
  base: Retriever
  stages: readonly RetrievalPipelineStage[]
  query: string
  options: RetrieveOptions
}): Promise<{ hits: RetrieverHit[]; trace: RetrievalPipelineTrace }> {
  const startedAt = Date.now()
  const retrievalId = `${startedAt}-retrieval-pipeline-${++retrievalPipelineCounter}`
  const pipelineId = args.base.id
  if (args.stages.length === 0) {
    const hits = await args.base.retrieve(args.query, args.options)
    return {
      hits,
      trace: {
        retrievalId,
        pipelineId,
        retrieverId: args.base.id,
        namespace: args.base.namespace,
        query: args.query,
        stages: [],
        resultCount: hits.length,
        durationMs: Date.now() - startedAt,
      },
    }
  }
  let queries: PlannedRetrievalQuery[] = [normalizePlannedQuery({ query: args.query, filter: args.options.filter })]
  let hits: RetrieverHit[] = []
  const traces: RetrievalStageTrace[] = []

  for (const stage of args.stages) {
    if (stage.phase !== 'query') continue
    const inputCount = queries.length
    const stageResult = await runPipelineStage({
      retrievalId,
      retrieverId: args.base.id,
      pipelineId,
      namespace: args.base.namespace,
      query: args.query,
      stage,
      inputQueryCount: inputCount,
      run: async () =>
        normalizeQueryStageResult(
          await stage.run({
            retrieverId: args.base.id,
            pipelineId,
            namespace: args.base.namespace,
            query: args.query,
            options: args.options,
            queries,
          }),
        ),
    })
    queries = stageResult.value.queries.map(normalizePlannedQuery)
    if (queries.length === 0) throw new Error(`Retrieval stage "${stage.name}" returned no planned queries.`)
    traces.push(stageResult.trace)
  }

  const fanoutResult = await runPipelineStage({
    retrievalId,
    retrieverId: args.base.id,
    pipelineId,
    namespace: args.base.namespace,
    query: args.query,
    stage: fanoutStage,
    inputQueryCount: queries.length,
    run: async () => {
      const hitGroups: Array<{ planned: PlannedRetrievalQuery; hits: RetrieverHit[] }> = []
      for (const planned of queries) {
        const options = mergeRetrieveOptions(args.options, planned)
        hitGroups.push({
          planned,
          hits: await args.base.retrieve(planned.query, options),
        })
      }
      return { value: { hits: mergeHitGroups(hitGroups) } }
    },
  })
  hits = fanoutResult.value.hits
  traces.push(fanoutResult.trace)

  for (const stage of args.stages) {
    if (stage.phase !== 'hits') continue
    const inputCount = hits.length
    const stageResult = await runPipelineStage({
      retrievalId,
      retrieverId: args.base.id,
      pipelineId,
      namespace: args.base.namespace,
      query: args.query,
      stage,
      inputHitCount: inputCount,
      run: async () =>
        normalizeHitStageResult(
          await stage.run({
            retrieverId: args.base.id,
            pipelineId,
            namespace: args.base.namespace,
            query: args.query,
            options: args.options,
            hits,
          }),
        ),
    })
    hits = [...stageResult.value.hits]
    traces.push(stageResult.trace)
  }

  return {
    hits,
    trace: {
      retrievalId,
      pipelineId,
      retrieverId: args.base.id,
      namespace: args.base.namespace,
      query: args.query,
      stages: traces,
      resultCount: hits.length,
      durationMs: Date.now() - startedAt,
    },
  }
}

const fanoutStage: HitRetrievalStage = Object.freeze({
  _tag: 'RetrievalStage' as const,
  name: 'fanout',
  phase: 'hits',
  kind: 'custom',
  run: (input: HitStageInput) => input.hits,
})

function validatePipelineStages(stages: readonly RetrievalPipelineStage[]): void {
  const names = new Set<string>()
  let sawHitStage = false
  for (const stage of stages) {
    validateStageName(stage.name)
    if (names.has(stage.name)) {
      throw new Error(`Duplicate retrieval stage name "${stage.name}".`)
    }
    names.add(stage.name)
    if (stage.phase === 'hits') sawHitStage = true
    if (stage.phase === 'query' && sawHitStage) {
      throw new Error('Query retrieval stages must run before hit stages.')
    }
  }
}
