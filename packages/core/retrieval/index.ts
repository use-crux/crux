import { z } from 'zod'
import type { GenerateObjectFn, GenerateTextFn } from '../compaction/types'
import { context } from '../prompt/context'
import type { DenseEmbedding, SparseEmbedding } from '../embedding'
import type { QueryableCruxEntity } from '../tools/entity'
import { observe } from '../observability'
import { getRuntime } from '../runtime/runtime'
import { matchesFilter } from '../store/filter'
import type { CruxStore, DataStore, JsonObject, ScoredEntry, Storage, VectorHit, VectorStore } from '../store/types'
import type { AnyToolSet, Context, PromptInjection } from '../types'
import type { ToolDef } from '../types/tool'

export type RetrieverMode = 'dense' | 'sparse' | 'hybrid' | 'custom'
export type RetrievalInjectMode = 'context' | 'tool' | 'both'
export type RetrievalToolName = 'search' | 'getSource'

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

export type RetrieverTools<TConfig extends RetrievalToolConfig | undefined = undefined> = {
  [TName in IncludedRetrievalToolNames<TConfig> as PrefixedRetrievalToolName<
    TConfig extends { prefix?: infer TPrefix } ? TPrefix : undefined,
    TName
  >]: ToolDef
}

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
  provenance?: Record<string, unknown>
}

export interface RetrieveOptions {
  limit?: number
  threshold?: number
  filter?: Record<string, unknown>
  mode?: 'dense' | 'sparse' | 'hybrid'
  fusion?: 'rrf' | 'dbsf'
}

export interface RerankerInput {
  retrieverId: string
  namespace: string
  mode: RetrieverMode
  query: string
  hits: RetrieverHit[]
}

export interface RetrieverReranker {
  readonly _tag: 'Reranker'
  readonly name: string
  rerank(input: RerankerInput): Promise<RetrieverHit[]> | RetrieverHit[]
}

export type RetrievalStagePhase = 'query' | 'hits'

export type RetrievalStageKind =
  | 'query-planner'
  | 'multi-query'
  | 'parent-expand'
  | 'compress'
  | 'diversify'
  | 'decay'
  | 'custom'

export interface PlannedRetrievalQuery<TFilter extends Record<string, unknown> = Record<string, unknown>> {
  query: string
  filter?: TFilter
  weight?: number
  reason?: string
}

export interface QueryStageInput {
  retrieverId: string
  pipelineId: string
  namespace: string
  query: string
  options: RetrieveOptions
  queries: readonly PlannedRetrievalQuery[]
}

export interface HitStageInput {
  retrieverId: string
  pipelineId: string
  namespace: string
  query: string
  options: RetrieveOptions
  hits: readonly RetrieverHit[]
}

export interface RetrievalStagePreview {
  queries?: Array<{ query: string; filter?: Record<string, unknown>; reason?: string }>
  hits?: Array<{ sourceId: string; chunkId: string; score: number; contentPreview?: string }>
}

export interface RetrievalStageTrace {
  name: string
  kind: RetrievalStageKind
  phase: RetrievalStagePhase
  status: 'success' | 'error' | 'skipped'
  inputQueryCount?: number
  outputQueryCount?: number
  inputHitCount?: number
  outputHitCount?: number
  durationMs: number
  warningCount?: number
  warnings?: string[]
  error?: string
  preview?: RetrievalStagePreview
}

export interface RetrievalPipelineTrace {
  retrievalId: string
  pipelineId: string
  retrieverId: string
  namespace: string
  query: string
  stages: RetrievalStageTrace[]
  resultCount: number
  durationMs: number
}

type QueryStageResult =
  | readonly PlannedRetrievalQuery[]
  | {
      queries: readonly PlannedRetrievalQuery[]
      warnings?: string[]
    }

type HitStageResult =
  | readonly RetrieverHit[]
  | {
      hits: readonly RetrieverHit[]
      warnings?: string[]
    }

export interface QueryRetrievalStage {
  readonly _tag: 'RetrievalStage'
  readonly phase: 'query'
  readonly kind: RetrievalStageKind
  readonly name: string
  run(input: QueryStageInput): Promise<QueryStageResult> | QueryStageResult
}

export interface HitRetrievalStage {
  readonly _tag: 'RetrievalStage'
  readonly phase: 'hits'
  readonly kind: RetrievalStageKind
  readonly name: string
  run(input: HitStageInput): Promise<HitStageResult> | HitStageResult
}

export type RetrievalPipelineStage = QueryRetrievalStage | HitRetrievalStage

export interface Retriever extends QueryableCruxEntity {
  readonly _tag: 'Retriever' | 'RetrievalPipeline'
  readonly id: string
  readonly namespace: string
  readonly mode: RetrieverMode
  retrieve(query: string, options?: RetrieveOptions): Promise<RetrieverHit[]>
  asContext(options?: {
    priority?: number
    query?: string | ((input: Record<string, unknown>) => string)
    limit?: number
    renderContext?: (hits: RetrieverHit[], meta: { query: string; mode: RetrieverMode; namespace: string }) => string
  }): Context<z.ZodType<{}>>
  asTools(): RetrieverTools
  asTools<const TConfig extends RetrievalToolConfig & { initialHits?: readonly RetrieverHit[] }>(
    options: TConfig,
  ): RetrieverTools<TConfig>
  inject(args: { input: Record<string, unknown>; promptId?: string }): Promise<PromptInjection>
}

export interface RetrievalPipeline extends Retriever {
  readonly _tag: 'RetrievalPipeline'
  readonly base: Retriever
  readonly stages: readonly RetrievalPipelineStage[]
  retrieveWithTrace(
    query: string,
    options?: RetrieveOptions,
  ): Promise<{
    hits: RetrieverHit[]
    trace: RetrievalPipelineTrace
  }>
}

interface RetrieverContextConfig {
  priority?: number
  query?: string | ((input: Record<string, unknown>) => string)
  limit?: number
  renderContext?: (hits: RetrieverHit[], meta: { query: string; mode: RetrieverMode; namespace: string }) => string
}

interface RetrievalInjectionConfig {
  inject?: RetrievalInjectMode
  tools?: false | RetrievalToolConfig
}

interface DenseStoreBackedRetrieverConfig {
  id: string
  namespace: string
  data?: DataStore
  vectors?: VectorStore
  storage?: Storage
  store?: CruxStore
  dense?: DenseEmbedding
  sparse?: SparseEmbedding
  rerank?: RetrieverReranker | RetrieverReranker[]
  search?: {
    mode?: 'dense' | 'sparse' | 'hybrid'
    limit?: number
    threshold?: number
    filter?: Record<string, unknown>
    fusion?: 'rrf' | 'dbsf'
  }
  context?: RetrieverContextConfig
  inject?: RetrievalInjectMode
  tools?: false | RetrievalToolConfig
}

interface CustomRetrieverConfig {
  id: string
  namespace: string
  retrieve: (query: string, options: RetrieveOptions) => Promise<RetrieverHit[]>
  rerank?: RetrieverReranker | RetrieverReranker[]
  context?: RetrieverContextConfig
  inject?: RetrievalInjectMode
  tools?: false | RetrievalToolConfig
}

export function reranker(config: {
  name: string
  rerank(input: RerankerInput): Promise<RetrieverHit[]> | RetrieverHit[]
}): RetrieverReranker {
  if (!config.name.trim()) {
    throw new Error('Reranker name must be non-empty.')
  }

  return Object.freeze({
    _tag: 'Reranker' as const,
    name: config.name,
    rerank: config.rerank,
  })
}

export function retrievalStage(config: {
  name: string
  phase: 'query'
  kind?: RetrievalStageKind
  run(input: QueryStageInput): Promise<QueryStageResult> | QueryStageResult
}): QueryRetrievalStage
export function retrievalStage(config: {
  name: string
  phase: 'hits'
  kind?: RetrievalStageKind
  run(input: HitStageInput): Promise<HitStageResult> | HitStageResult
}): HitRetrievalStage
export function retrievalStage(config: {
  name: string
  phase: RetrievalStagePhase
  kind?: RetrievalStageKind
  run(
    input: QueryStageInput | HitStageInput,
  ): Promise<QueryStageResult | HitStageResult> | QueryStageResult | HitStageResult
}): RetrievalPipelineStage {
  validateStageName(config.name)
  return Object.freeze({
    _tag: 'RetrievalStage' as const,
    name: config.name,
    phase: config.phase,
    kind: config.kind ?? 'custom',
    run: config.run,
  } as RetrievalPipelineStage)
}

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

export function queryPlanner<
  TFilter extends z.ZodType<Record<string, unknown>> = z.ZodType<Record<string, unknown>>,
>(config: {
  name?: string
  generate: GenerateObjectFn
  model: unknown
  maxQueries?: number
  filterSchema?: TFilter
  system?: string
}): QueryRetrievalStage {
  const maxQueries = config.maxQueries ?? 4
  const filterSchema = config.filterSchema ?? z.record(z.string(), z.unknown())
  const plannedQuerySchema = z.object({
    query: z.string().trim().min(1),
    filter: filterSchema.optional(),
    weight: z.number().positive().optional(),
    reason: z.string().trim().min(1).optional(),
  })
  const outputSchema = z.object({
    queries: z.array(plannedQuerySchema).min(1).max(maxQueries),
  })

  return retrievalStage({
    name: config.name ?? 'query-planner',
    phase: 'query',
    kind: 'query-planner',
    async run({ query }) {
      const result = await config.generate({
        model: config.model,
        system:
          config.system ??
          'Plan retrieval subqueries. Return focused search queries and optional metadata filters. Do not answer the user.',
        prompt: `User query:\n${query}\n\nReturn at most ${maxQueries} retrieval queries.`,
        schema: outputSchema,
      })
      const parsed = outputSchema.safeParse(result.object)
      if (!parsed.success) {
        throw new Error(`queryPlanner returned invalid planned queries: ${parsed.error.message}`)
      }
      return parsed.data.queries.map(normalizePlannedQuery)
    },
  })
}

export function multiQuery(config: {
  name?: string
  generate: GenerateTextFn
  model: unknown
  count?: number
  includeOriginal?: boolean
  system?: string
}): QueryRetrievalStage {
  const count = config.count ?? 4
  const includeOriginal = config.includeOriginal ?? true
  return retrievalStage({
    name: config.name ?? 'multi-query',
    phase: 'query',
    kind: 'multi-query',
    async run({ queries }) {
      const expanded: PlannedRetrievalQuery[] = []
      for (const planned of queries) {
        if (includeOriginal) expanded.push(planned)
        const result = await config.generate({
          model: config.model,
          system:
            config.system ??
            'Generate alternate retrieval queries. Return one query per line. Do not number the lines and do not answer.',
          prompt: `Original query:\n${planned.query}\n\nGenerate ${count} alternate retrieval queries.`,
        })
        for (const generated of parseGeneratedQueries(result.text, count)) {
          expanded.push({
            ...planned,
            query: generated,
          })
        }
      }
      return dedupePlannedQueries(expanded)
    },
  })
}

export function parentExpand(config: {
  store: DataStore
  indexerId?: string
  maxParentChars?: number
  missing?: 'ignore' | 'warn' | 'error'
}): HitRetrievalStage {
  const missing = config.missing ?? 'warn'
  return retrievalStage({
    name: 'parent-expand',
    phase: 'hits',
    kind: 'parent-expand',
    async run({ hits, retrieverId }) {
      const warnings: string[] = []
      const expanded: RetrieverHit[] = []
      for (const hit of hits) {
        const parentKeyValue = hit.parent?.key ?? deriveParentKey(config.indexerId ?? retrieverId, hit)
        if (!parentKeyValue) {
          expanded.push(hit)
          continue
        }

        const parentRecord = await config.store.get(parentKeyValue)
        if (!parentRecord) {
          const warning = `parentExpand could not find parent record "${parentKeyValue}" for ${hit.sourceId}/${hit.chunkId}.`
          if (missing === 'error') throw new Error(warning)
          if (missing === 'warn') warnings.push(warning)
          expanded.push(hit)
          continue
        }

        const parentContent = typeof parentRecord.content === 'string' ? parentRecord.content : undefined
        const truncatedContent =
          parentContent && config.maxParentChars !== undefined
            ? parentContent.slice(0, config.maxParentChars)
            : parentContent
        expanded.push({
          ...hit,
          parent: {
            ...(hit.parent ?? {}),
            ...(typeof parentRecord.parentId === 'string' ? { parentId: parentRecord.parentId } : {}),
            key: parentKeyValue,
            ...(typeof parentRecord.content === 'string' ? { content: truncatedContent } : {}),
            ...(isRecord(parentRecord.metadata) ? { metadata: parentRecord.metadata } : {}),
          },
        })
      }
      return { hits: expanded, warnings }
    },
  })
}

export function compress(config: {
  name?: string
  generate: GenerateObjectFn
  model: unknown
  mode?: 'extractive'
  maxCharsPerHit?: number
  keepEmpty?: boolean
  system?: string
}): HitRetrievalStage {
  if (config.mode && config.mode !== 'extractive') {
    throw new Error('compress() currently supports only mode: "extractive".')
  }
  const outputSchema = z.object({
    hits: z.array(
      z.object({
        sourceId: z.string(),
        chunkId: z.string(),
        excerpts: z.array(z.string()),
      }),
    ),
  })

  return retrievalStage({
    name: config.name ?? 'compress',
    phase: 'hits',
    kind: 'compress',
    async run({ query, hits }) {
      const result = await config.generate({
        model: config.model,
        system:
          config.system ??
          'Extract only query-relevant verbatim excerpts from retrieved chunks. Preserve sourceId and chunkId.',
        prompt: JSON.stringify({
          query,
          maxCharsPerHit: config.maxCharsPerHit ?? 1200,
          hits: hits.map((hitItem) => ({
            sourceId: hitItem.sourceId,
            chunkId: hitItem.chunkId,
            content: hitItem.content,
          })),
        }),
        schema: outputSchema,
      })
      const parsed = outputSchema.parse(result.object)
      const excerptsById = new Map(parsed.hits.map((item) => [sourceChunkIdentity(item), item.excerpts]))
      const compressed: RetrieverHit[] = []
      for (const hitItem of hits) {
        const excerpts = (excerptsById.get(sourceChunkIdentity(hitItem)) ?? [])
          .map((excerpt) => excerpt.trim())
          .filter(Boolean)
        if (excerpts.length === 0 && !config.keepEmpty) continue
        const content = excerpts.join('\n\n').slice(0, config.maxCharsPerHit ?? Number.MAX_SAFE_INTEGER)
        compressed.push({
          ...hitItem,
          content,
          metadata: {
            ...hitItem.metadata,
            _cruxCompression: {
              originalLength: hitItem.content.length,
              compressedLength: content.length,
            },
          },
        })
      }
      return compressed
    },
  })
}

export function diversify(config: {
  name?: string
  strategy: 'mmr'
  lambda?: number
  limit?: number
  sourcePenalty?: number
}): HitRetrievalStage {
  const lambda = config.lambda ?? 0.5
  const sourcePenalty = config.sourcePenalty ?? 0
  return retrievalStage({
    name: config.name ?? 'diversify',
    phase: 'hits',
    kind: 'diversify',
    run({ hits }) {
      const remaining = [...hits]
      const selected: RetrieverHit[] = []
      const limit = config.limit ?? remaining.length

      while (remaining.length > 0 && selected.length < limit) {
        let bestIndex = 0
        let bestScore = Number.NEGATIVE_INFINITY
        for (let index = 0; index < remaining.length; index++) {
          const candidate = remaining[index]
          const similarityPenalty = selected.reduce(
            (max, item) => Math.max(max, contentSimilarity(candidate.content, item.content)),
            0,
          )
          const sourceDupPenalty = selected.some((item) => item.sourceId === candidate.sourceId) ? sourcePenalty : 0
          const mmrScore = lambda * candidate.score - (1 - lambda) * similarityPenalty - sourceDupPenalty
          if (mmrScore > bestScore) {
            bestIndex = index
            bestScore = mmrScore
          }
        }
        const [chosen] = remaining.splice(bestIndex, 1)
        selected.push({
          ...chosen,
          metadata: {
            ...chosen.metadata,
            _cruxDiversity: { strategy: config.strategy, mmrScore: bestScore },
          },
        })
      }
      return selected
    },
  })
}

export function decay(config: {
  name?: string
  field: string
  halfLifeMs: number
  missing?: 'ignore' | 'penalize' | 'error'
}): HitRetrievalStage {
  const missing = config.missing ?? 'ignore'
  return retrievalStage({
    name: config.name ?? 'decay',
    phase: 'hits',
    kind: 'decay',
    run({ hits }) {
      const now = Date.now()
      return hits
        .map((hitItem) => {
          const raw = readPath(hitItem, config.field)
          if (typeof raw !== 'number' || !Number.isFinite(raw)) {
            if (missing === 'error') {
              throw new Error(`decay() could not read numeric timestamp at "${config.field}".`)
            }
            if (missing === 'penalize') {
              return annotateDecay(hitItem, config.field, 0.5, hitItem.score * 0.5)
            }
            return hitItem
          }
          const ageMs = Math.max(0, now - raw)
          const factor = Math.pow(0.5, ageMs / config.halfLifeMs)
          return annotateDecay(hitItem, config.field, factor, hitItem.score * factor)
        })
        .sort((a, b) => b.score - a.score)
    },
  })
}

export function retriever(config: DenseStoreBackedRetrieverConfig | CustomRetrieverConfig): Retriever {
  validateBaseConfig(config)

  if (isCustomConfig(config)) {
    return createCustomRetriever(config)
  }

  validateDenseStoreBackedConfig(config)
  return createDenseStoreBackedRetriever(config)
}

function validateBaseConfig(config: { id: string; namespace: string }): void {
  if (!config.id.trim()) {
    throw new Error('Retriever id must be non-empty.')
  }
  if (!config.namespace.trim()) {
    throw new Error('Retriever namespace must be non-empty.')
  }
}

function isCustomConfig(
  config: DenseStoreBackedRetrieverConfig | CustomRetrieverConfig,
): config is CustomRetrieverConfig {
  return 'retrieve' in config && typeof config.retrieve === 'function'
}

function validateDenseStoreBackedConfig(
  config: Partial<DenseStoreBackedRetrieverConfig>,
): asserts config is DenseStoreBackedRetrieverConfig {
  const mode = deriveStoreBackedMode(config)
  const data = getRetrieverDataStore(config)
  const vectors = getRetrieverVectorStore(config)
  const legacyStore = config.store

  if (mode === 'dense') {
    if (!config.dense) {
      throw new Error('Store-backed retriever requires a dense embedding.')
    }
    if (!vectors && !legacyStore?.vectorSearch && !legacyStore?.searchVectors) {
      throw new Error('Dense retriever requires vectors.search(), store.vectorSearch(), or store.searchVectors().')
    }
    if (vectors && !data) {
      throw new Error('Retriever with vectors requires data to hydrate vector hits.')
    }
    return
  }

  if (mode === 'sparse') {
    if (!config.sparse) {
      throw new Error('Sparse retriever requires a sparse embedding.')
    }
    if (!vectors && !legacyStore?.searchVectors) {
      throw new Error('Sparse retriever requires vectors.search() or store.searchVectors().')
    }
    if (vectors && !data) {
      throw new Error('Retriever with vectors requires data to hydrate vector hits.')
    }
    return
  }

  if (!config.dense || !config.sparse) {
    throw new Error('Hybrid retriever requires both dense and sparse embeddings.')
  }
  if (!vectors && !legacyStore?.searchVectors) {
    throw new Error('Hybrid retriever requires vectors.search() or store.searchVectors().')
  }
  if (vectors && !data) {
    throw new Error('Retriever with vectors requires data to hydrate vector hits.')
  }
}

function createDenseStoreBackedRetriever(config: DenseStoreBackedRetrieverConfig): Retriever {
  const defaultMode = deriveStoreBackedMode(config)
  const rerankers = normalizeRerankers(config.rerank)

  const retrieve: Retriever['retrieve'] = async (query, options = {}) => {
    const mode = options.mode ?? config.search?.mode ?? defaultMode
    const limit = options.limit ?? config.search?.limit
    const threshold = options.threshold ?? config.search?.threshold
    const filter = {
      ...(config.search?.filter ?? {}),
      ...(options.filter ?? {}),
      namespace: config.namespace,
      _cruxRecordType: 'chunk',
      active: true,
    }
    const fusion = options.fusion ?? config.search?.fusion

    return runRetrievalOperation({
      retrieverId: config.id,
      namespace: config.namespace,
      mode,
      query,
      limit,
      threshold,
      filter,
      fusion,
      run: async () => {
        const results =
          mode === 'dense'
            ? await runDenseSearch(config, query, { limit, threshold, filter })
            : mode === 'sparse'
              ? await runSparseSearch(config, query, { limit, threshold, filter })
              : await runHybridSearch(config, query, { limit, threshold, filter, fusion })

        const hits = results.map(mapScoredEntryToHit)
        return applyRerankers(rerankers, {
          retrieverId: config.id,
          namespace: config.namespace,
          mode,
          query,
          hits,
        })
      },
    })
  }

  return createRetrieverEntity({
    id: config.id,
    namespace: config.namespace,
    mode: defaultMode,
    retrieve,
    defaultContext: config.context,
    defaultInject: config.inject,
    defaultTools: config.tools,
  })
}

function createCustomRetriever(config: CustomRetrieverConfig): Retriever {
  const rerankers = normalizeRerankers(config.rerank)
  return createRetrieverEntity({
    id: config.id,
    namespace: config.namespace,
    mode: 'custom',
    retrieve: (query, options = {}) =>
      runRetrievalOperation({
        retrieverId: config.id,
        namespace: config.namespace,
        mode: 'custom',
        query,
        limit: options.limit,
        threshold: options.threshold,
        filter: options.filter,
        fusion: options.fusion,
        run: async () =>
          applyRerankers(rerankers, {
            retrieverId: config.id,
            namespace: config.namespace,
            mode: 'custom',
            query,
            hits: await config.retrieve(query, options),
          }),
      }),
    defaultContext: config.context,
    defaultInject: config.inject,
    defaultTools: config.tools,
  })
}

function createRetrieverEntity(args: {
  id: string
  namespace: string
  mode: RetrieverMode
  retrieve: (query: string, options?: RetrieveOptions) => Promise<RetrieverHit[]>
  defaultContext?: RetrieverContextConfig
  defaultInject?: RetrievalInjectMode
  defaultTools?: false | RetrievalToolConfig
}): Retriever {
  const retrieve: Retriever['retrieve'] = (query, options) => args.retrieve(query, options ?? {})

  return Object.freeze({
    _tag: 'Retriever' as const,
    id: args.id,
    namespace: args.namespace,
    mode: args.mode,

    retrieve,

    asContext(options?: {
      priority?: number
      query?: string | ((input: Record<string, unknown>) => string)
      limit?: number
      renderContext?: (hits: RetrieverHit[], meta: { query: string; mode: RetrieverMode; namespace: string }) => string
    }): Context<z.ZodType<{}>> {
      const querySource = options?.query ?? args.defaultContext?.query
      const priority = options?.priority ?? args.defaultContext?.priority ?? 50
      const limit = options?.limit ?? args.defaultContext?.limit ?? 5
      const renderContext = options?.renderContext ?? args.defaultContext?.renderContext ?? defaultRenderContext

      return context({
        id: `retriever:${args.id}`,
        description: `Retriever context for ${args.id}`,
        family: 'retriever',
        priority,
        system: async ({ input }) => {
          const query = resolveQuery(querySource, input)
          if (!query) {
            throw new Error(
              `Retriever "${args.id}" asContext() requires a query via config.context.query or options.query.`,
            )
          }

          const hits = await retrieve(query, { limit })
          if (hits.length === 0) return ''
          return renderContext(hits, { query, mode: args.mode, namespace: args.namespace })
        },
      })
    },

    asTools<const TConfig extends RetrievalToolConfig & { initialHits?: readonly RetrieverHit[] }>(
      options?: TConfig,
    ): RetrieverTools<TConfig> {
      return createRetrieverTools({
        id: args.id,
        namespace: args.namespace,
        retrieve,
        config: options,
      }) as RetrieverTools<TConfig>
    },

    async inject({ input }: { input: Record<string, unknown>; promptId?: string }): Promise<PromptInjection> {
      const injectMode = args.defaultInject ?? (args.defaultContext?.query ? 'context' : 'tool')
      const contexts: Context[] = []
      let tools: AnyToolSet | undefined
      let initialHits: RetrieverHit[] = []

      if (injectMode === 'context' || injectMode === 'both') {
        const query = resolveQuery(args.defaultContext?.query, input)
        if (!query) {
          throw new Error(`Retriever "${args.id}" inject:${injectMode} requires context.query.`)
        }
        initialHits = await retrieve(query, { limit: args.defaultContext?.limit })
        const renderContext = args.defaultContext?.renderContext ?? defaultRenderContext
        const rendered = initialHits.length
          ? renderContext(initialHits, { query, mode: args.mode, namespace: args.namespace })
          : ''
        contexts.push(
          context({
            id: `retriever:${args.id}`,
            description: `Retriever context for ${args.id}`,
            family: 'retriever',
            priority: args.defaultContext?.priority ?? 50,
            system: rendered,
          }),
        )
      }

      if (injectMode === 'tool' || injectMode === 'both') {
        const toolConfig = args.defaultTools === false ? { enabled: false } : args.defaultTools
        if (toolConfig?.enabled !== false) {
          tools = createRetrieverTools({
            id: args.id,
            namespace: args.namespace,
            retrieve,
            config: { ...(toolConfig ?? {}), initialHits },
          })
        }
      }

      return {
        ...(contexts.length ? { contexts } : {}),
        ...(tools && Object.keys(tools).length > 0 ? { tools } : {}),
      }
    },
  })
}

function resolveQuery(
  query: string | ((input: Record<string, unknown>) => string) | undefined,
  input: Record<string, unknown>,
): string | undefined {
  if (!query) return undefined
  return typeof query === 'function' ? query(input) : query
}

function createRetrieverTools(args: {
  id: string
  namespace: string
  retrieve: Retriever['retrieve']
  config?: RetrievalToolConfig & { initialHits?: readonly RetrieverHit[] }
}): Record<string, ToolDef> {
  const include = new Set<RetrievalToolName>(args.config?.include ?? ['search'])
  const prefix = resolveToolPrefix(args.id, args.config?.prefix)
  const seenHits = new Map<string, RetrieverHit>()
  for (const hit of args.config?.initialHits ?? []) {
    seenHits.set(toolHitKey(hit), hit)
  }

  const tools: Record<string, ToolDef> = {}
  if (include.has('search')) {
    tools[toolName(prefix, 'search')] = {
      description: `Search the "${args.namespace}" knowledge base through retriever "${args.id}". Returns scored chunks with source and chunk IDs.`,
      parameters: z.object({
        query: z.string().min(1).describe('Natural-language search query.'),
        limit: z.number().int().positive().optional().describe('Maximum number of hits to return.'),
        threshold: z.number().optional().describe('Minimum similarity threshold.'),
      }),
      async execute(rawArgs: Record<string, unknown>): Promise<string> {
        const parsed = z
          .object({
            query: z.string().min(1),
            limit: z.number().int().positive().optional(),
            threshold: z.number().optional(),
          })
          .parse(rawArgs)
        const hits = await args.retrieve(parsed.query, { limit: parsed.limit, threshold: parsed.threshold })
        for (const hit of hits) {
          seenHits.set(toolHitKey(hit), hit)
        }
        return JSON.stringify(hits)
      },
    }
  }

  if (include.has('getSource')) {
    tools[toolName(prefix, 'getSource')] = {
      description: `Return a previously retrieved source chunk from "${args.namespace}". Call search first if the source is not already in context.`,
      parameters: z.object({
        namespace: z.string().optional(),
        sourceId: z.string().min(1),
        chunkId: z.string().min(1),
      }),
      async execute(rawArgs: Record<string, unknown>): Promise<string> {
        const parsed = z
          .object({
            namespace: z.string().optional(),
            sourceId: z.string().min(1),
            chunkId: z.string().min(1),
          })
          .parse(rawArgs)
        const key = `${parsed.namespace ?? args.namespace}:${parsed.sourceId}:${parsed.chunkId}`
        const hit = seenHits.get(key)
        if (!hit) {
          throw new Error(`Source ${key} has not been retrieved yet. Call ${toolName(prefix, 'search')} first.`)
        }
        return JSON.stringify(hit)
      },
    }
  }

  return tools
}

function toolName(prefix: string, base: RetrievalToolName): string {
  return prefix ? `${prefix}${base[0].toUpperCase()}${base.slice(1)}` : base
}

function resolveToolPrefix(id: string, prefix: boolean | string | undefined): string {
  if (prefix === true) return `${toToolPrefix(id)}`
  if (typeof prefix === 'string') return `${toToolPrefix(prefix)}`
  return ''
}

function toToolPrefix(value: string): string {
  const words = value.split(/[^a-zA-Z0-9]+/).filter(Boolean)
  if (words.length === 0) return ''
  return words
    .map((word, index) => {
      const lower = word.toLowerCase()
      return index === 0 ? lower : lower[0].toUpperCase() + lower.slice(1)
    })
    .join('')
}

function toolHitKey(hit: Pick<RetrieverHit, 'namespace' | 'sourceId' | 'chunkId'>): string {
  return `${hit.namespace}:${hit.sourceId}:${hit.chunkId}`
}

function normalizeRerankers(rerank?: RetrieverReranker | RetrieverReranker[]): RetrieverReranker[] {
  if (!rerank) return []
  return Array.isArray(rerank) ? rerank : [rerank]
}

async function applyRerankers(rerankers: RetrieverReranker[], input: RerankerInput): Promise<RetrieverHit[]> {
  let hits = input.hits
  for (const reranker of rerankers) {
    hits = await reranker.rerank({ ...input, hits })
  }
  return hits
}

function mapScoredEntryToHit(entry: ScoredEntry): RetrieverHit {
  const metadata = isRecord(entry.value.metadata) ? entry.value.metadata : {}
  const parent = isRecord(entry.value.parent)
    ? {
        ...(typeof entry.value.parent.parentId === 'string' ? { parentId: entry.value.parent.parentId } : {}),
        ...(typeof entry.value.parent.key === 'string' ? { key: entry.value.parent.key } : {}),
        ...(typeof entry.value.parent.title === 'string' ? { title: entry.value.parent.title } : {}),
        ...(typeof entry.value.parent.summary === 'string' ? { summary: entry.value.parent.summary } : {}),
      }
    : undefined

  return {
    namespace: String(entry.value.namespace),
    sourceId: String(entry.value.sourceId),
    chunkId: String(entry.value.chunkId),
    content: String(entry.value.content),
    metadata,
    score: entry.score,
    ...(typeof entry.value.sourceUrl === 'string' ? { sourceUrl: entry.value.sourceUrl } : {}),
    ...(typeof entry.value.sourcePath === 'string' ? { sourcePath: entry.value.sourcePath } : {}),
    ...(parent && Object.keys(parent).length > 0 ? { parent } : {}),
    ...(isRecord(entry.value.provenance) ? { provenance: entry.value.provenance } : {}),
  }
}

let retrievalPipelineCounter = 0

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

async function runPipelineStage<
  T extends { queries: readonly PlannedRetrievalQuery[] } | { hits: readonly RetrieverHit[] },
>(args: {
  retrievalId: string
  retrieverId: string
  pipelineId: string
  namespace: string
  query: string
  stage: RetrievalPipelineStage
  inputQueryCount?: number
  inputHitCount?: number
  run: () => Promise<{ value: T; warnings?: string[] }>
}): Promise<{ value: T; trace: RetrievalStageTrace }> {
  const startedAt = Date.now()
  const eventBase = {
    retrievalId: args.retrievalId,
    retrieverId: args.retrieverId,
    pipelineId: args.pipelineId,
    stageName: args.stage.name,
    stageKind: args.stage.kind,
    phase: args.stage.phase,
    ...(args.inputQueryCount !== undefined ? { inputQueryCount: args.inputQueryCount } : {}),
    ...(args.inputHitCount !== undefined ? { inputHitCount: args.inputHitCount } : {}),
  }
  const span = observe.openSpan({
    name: `${args.stage.phase}:${args.stage.name}`,
    family: 'retrieval',
    primitive: 'retrieval.stage',
    attributes: {
      ...eventBase,
      query: args.query,
    },
  })

  getRuntime().instrumentationHooks?.onRetrievalStageStart?.(eventBase)

  try {
    const result = await span.withContext(args.run)
    const durationMs = Date.now() - startedAt
    const outputQueryCount = 'queries' in result.value ? result.value.queries.length : undefined
    const outputHitCount = 'hits' in result.value ? result.value.hits.length : undefined
    const preview = createStagePreview(result.value)
    const trace: RetrievalStageTrace = {
      name: args.stage.name,
      kind: args.stage.kind,
      phase: args.stage.phase,
      status: 'success',
      ...(args.inputQueryCount !== undefined ? { inputQueryCount: args.inputQueryCount } : {}),
      ...(args.inputHitCount !== undefined ? { inputHitCount: args.inputHitCount } : {}),
      ...(outputQueryCount !== undefined ? { outputQueryCount } : {}),
      ...(outputHitCount !== undefined ? { outputHitCount } : {}),
      durationMs,
      warningCount: result.warnings?.length ?? 0,
      ...(result.warnings?.length ? { warnings: result.warnings } : {}),
      preview,
    }
    getRuntime().instrumentationHooks?.onRetrievalStageEnd?.({
      ...eventBase,
      status: 'success',
      ...(outputQueryCount !== undefined ? { outputQueryCount } : {}),
      ...(outputHitCount !== undefined ? { outputHitCount } : {}),
      durationMs,
      warningCount: result.warnings?.length ?? 0,
      preview,
    })
    span.withContext(() => {
      emitStageOutputArtifact(span.spanId, eventBase, preview, {
        ...(outputQueryCount !== undefined ? { outputQueryCount } : {}),
        ...(outputHitCount !== undefined ? { outputHitCount } : {}),
        warningCount: result.warnings?.length ?? 0,
      })
    })
    span.end({
      attributes: {
        ...(outputQueryCount !== undefined ? { outputQueryCount } : {}),
        ...(outputHitCount !== undefined ? { outputHitCount } : {}),
        warningCount: result.warnings?.length ?? 0,
      },
    })
    return { value: result.value, trace }
  } catch (error) {
    const durationMs = Date.now() - startedAt
    const message = error instanceof Error ? error.message : String(error)
    getRuntime().instrumentationHooks?.onRetrievalStageEnd?.({
      ...eventBase,
      status: 'error',
      durationMs,
      warningCount: 0,
      error: message,
    })
    span.error(error, { status: 'error', warningCount: 0 })
    throw error
  }
}

function normalizeQueryStageResult(result: QueryStageResult): {
  value: { queries: readonly PlannedRetrievalQuery[] }
  warnings?: string[]
} {
  if (isPlannedQueryArray(result)) {
    return { value: { queries: result } }
  }
  return { value: { queries: result.queries }, warnings: result.warnings }
}

function normalizeHitStageResult(result: HitStageResult): {
  value: { hits: readonly RetrieverHit[] }
  warnings?: string[]
} {
  if (isRetrieverHitArray(result)) {
    return { value: { hits: result } }
  }
  return { value: { hits: result.hits }, warnings: result.warnings }
}

function isPlannedQueryArray(result: QueryStageResult): result is readonly PlannedRetrievalQuery[] {
  return Array.isArray(result)
}

function isRetrieverHitArray(result: HitStageResult): result is readonly RetrieverHit[] {
  return Array.isArray(result)
}

function createStagePreview(
  value: { queries: readonly PlannedRetrievalQuery[] } | { hits: readonly RetrieverHit[] },
): RetrievalStagePreview {
  if ('queries' in value) {
    return {
      queries: value.queries.slice(0, 5).map((query) => ({
        query: query.query,
        ...(query.filter ? { filter: query.filter } : {}),
        ...(query.reason ? { reason: query.reason } : {}),
      })),
    }
  }
  return {
    hits: value.hits.slice(0, 5).map((hitItem) => ({
      sourceId: hitItem.sourceId,
      chunkId: hitItem.chunkId,
      score: hitItem.score,
      contentPreview: hitItem.content.slice(0, 240),
    })),
  }
}

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

function validateStageName(name: string): void {
  if (!name.trim()) {
    throw new Error('Retrieval stage name must be non-empty.')
  }
}

function normalizePlannedQuery(query: PlannedRetrievalQuery): PlannedRetrievalQuery {
  const trimmed = query.query.trim()
  if (!trimmed) throw new Error('Planned retrieval query must be non-empty.')
  if (query.weight !== undefined && query.weight <= 0) {
    throw new Error('Planned retrieval query weight must be positive.')
  }
  return {
    query: trimmed,
    ...(query.filter ? { filter: query.filter } : {}),
    ...(query.weight !== undefined ? { weight: query.weight } : {}),
    ...(query.reason ? { reason: query.reason } : {}),
  }
}

function parseGeneratedQueries(text: string, count: number): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*\d.)]+\s*/, '').trim())
    .filter(Boolean)
    .slice(0, count)
}

function dedupePlannedQueries(queries: PlannedRetrievalQuery[]): PlannedRetrievalQuery[] {
  const seen = new Set<string>()
  const deduped: PlannedRetrievalQuery[] = []
  for (const query of queries) {
    const normalized = normalizePlannedQuery(query)
    const key = JSON.stringify({ query: normalized.query, filter: normalized.filter ?? {} })
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(normalized)
  }
  return deduped
}

function mergeRetrieveOptions(options: RetrieveOptions, planned: PlannedRetrievalQuery): RetrieveOptions {
  return {
    ...options,
    filter: {
      ...(options.filter ?? {}),
      ...(planned.filter ?? {}),
    },
  }
}

function mergeHitGroups(groups: Array<{ planned: PlannedRetrievalQuery; hits: RetrieverHit[] }>): RetrieverHit[] {
  const merged = new Map<
    string,
    {
      hit: RetrieverHit
      matchedQueries: string[]
      queryReasons: string[]
      ranks: number[]
      rawScores: number[]
      fusedScore: number
    }
  >()
  const k = 60

  groups.forEach((group) => {
    group.hits.forEach((hitItem, index) => {
      const identity = hitIdentity(hitItem)
      const rank = index + 1
      const current = merged.get(identity) ?? {
        hit: hitItem,
        matchedQueries: [],
        queryReasons: [],
        ranks: [],
        rawScores: [],
        fusedScore: 0,
      }
      current.matchedQueries.push(group.planned.query)
      if (group.planned.reason) current.queryReasons.push(group.planned.reason)
      current.ranks.push(rank)
      current.rawScores.push(hitItem.score)
      current.fusedScore += (group.planned.weight ?? 1) / (k + rank)
      if (hitItem.score > current.hit.score) current.hit = hitItem
      merged.set(identity, current)
    })
  })

  return [...merged.values()]
    .sort((a, b) => b.fusedScore - a.fusedScore || Math.max(...b.rawScores) - Math.max(...a.rawScores))
    .map((item) => ({
      ...item.hit,
      score: Math.max(...item.rawScores),
      metadata: {
        ...item.hit.metadata,
        _cruxRetrieval: {
          matchedQueries: item.matchedQueries,
          ...(item.queryReasons.length ? { queryReasons: item.queryReasons } : {}),
          ranks: item.ranks,
          rawScores: item.rawScores,
          fusedScore: item.fusedScore,
        },
      },
    }))
}

function hitIdentity(hit: Pick<RetrieverHit, 'namespace' | 'sourceId' | 'chunkId'>): string {
  return `${hit.namespace}/${hit.sourceId}/${hit.chunkId}`
}

function sourceChunkIdentity(hit: Pick<RetrieverHit, 'sourceId' | 'chunkId'>): string {
  return `${hit.sourceId}/${hit.chunkId}`
}

function deriveParentKey(indexerId: string, hit: RetrieverHit): string | undefined {
  if (!hit.parent?.parentId) return undefined
  return `indexer:${indexerId}:namespace:${hit.namespace}:source:${hit.sourceId}:parent:${hit.parent.parentId}`
}

function contentSimilarity(a: string, b: string): number {
  const left = tokenSet(a)
  const right = tokenSet(b)
  if (left.size === 0 || right.size === 0) return 0
  let intersection = 0
  for (const token of left) {
    if (right.has(token)) intersection++
  }
  return intersection / new Set([...left, ...right]).size
}

function tokenSet(value: string): Set<string> {
  return new Set(value.toLowerCase().match(/[a-z0-9]+/g) ?? [])
}

function readPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (!isRecord(current)) return undefined
    return current[segment]
  }, value)
}

function annotateDecay(hit: RetrieverHit, field: string, factor: number, score: number): RetrieverHit {
  return {
    ...hit,
    score,
    metadata: {
      ...hit.metadata,
      _cruxDecay: { field, factor },
    },
  }
}

function deriveStoreBackedMode(config: Partial<DenseStoreBackedRetrieverConfig>): RetrieverMode {
  if (config.search?.mode) {
    return config.search.mode
  }
  if (config.dense && config.sparse) {
    return 'hybrid'
  }
  if (config.sparse) {
    return 'sparse'
  }
  return 'dense'
}

async function runDenseSearch(
  config: DenseStoreBackedRetrieverConfig,
  query: string,
  options: { limit?: number; threshold?: number; filter?: Record<string, unknown> },
): Promise<ScoredEntry[]> {
  const denseQuery = await config.dense!.embed(query)
  const vectors = getRetrieverVectorStore(config)
  if (vectors) {
    return hydrateVectorHits(config, await vectors.search({ dense: denseQuery, ...options }), options.filter)
  }
  const store = getLegacyRetrieverStore(config)
  return store.vectorSearch
    ? store.vectorSearch(denseQuery, options)
    : store.searchVectors!({ dense: denseQuery, ...options })
}

async function runSparseSearch(
  config: DenseStoreBackedRetrieverConfig,
  query: string,
  options: { limit?: number; threshold?: number; filter?: Record<string, unknown> },
): Promise<ScoredEntry[]> {
  const sparseQuery = await config.sparse!.embed(query)
  const vectors = getRetrieverVectorStore(config)
  if (vectors) {
    return hydrateVectorHits(config, await vectors.search({ sparse: sparseQuery, ...options }), options.filter)
  }
  return getLegacyRetrieverStore(config).searchVectors!({ sparse: sparseQuery, ...options })
}

async function runHybridSearch(
  config: DenseStoreBackedRetrieverConfig,
  query: string,
  options: { limit?: number; threshold?: number; filter?: Record<string, unknown>; fusion?: 'rrf' | 'dbsf' },
): Promise<ScoredEntry[]> {
  const [denseQuery, sparseQuery] = await Promise.all([config.dense!.embed(query), config.sparse!.embed(query)])
  const vectorQuery = {
    dense: denseQuery,
    sparse: sparseQuery,
    limit: options.limit,
    threshold: options.threshold,
    filter: options.filter,
    fusion: options.fusion,
  }
  const vectors = getRetrieverVectorStore(config)
  if (vectors) {
    return hydrateVectorHits(config, await vectors.search(vectorQuery), options.filter)
  }
  return getLegacyRetrieverStore(config).searchVectors!(vectorQuery)
}

function getRetrieverDataStore(config: Partial<DenseStoreBackedRetrieverConfig>): DataStore | undefined {
  return config.data ?? config.storage?.data ?? config.store
}

function getRetrieverVectorStore(config: Partial<DenseStoreBackedRetrieverConfig>): VectorStore | undefined {
  return config.vectors ?? config.storage?.vectors
}

function getLegacyRetrieverStore(config: DenseStoreBackedRetrieverConfig): CruxStore {
  if (!config.store) {
    throw new Error('Retriever requires vectors or a store-backed vector search capability.')
  }
  return config.store
}

async function hydrateVectorHits(
  config: DenseStoreBackedRetrieverConfig,
  hits: readonly VectorHit[],
  filter?: Record<string, unknown>,
): Promise<ScoredEntry[]> {
  const data = getRetrieverDataStore(config)
  if (!data) {
    throw new Error('Retriever with vectors requires data to hydrate vector hits.')
  }

  const entries: ScoredEntry[] = []
  for (const hit of hits) {
    const value = await data.get(hit.key)
    if (!value) continue
    if (filter && !matchesFilter(value, filter)) continue
    entries.push({ key: hit.key, value, score: hit.score })
  }
  return entries
}

function defaultRenderContext(
  hits: RetrieverHit[],
  meta: { query: string; mode: RetrieverMode; namespace: string },
): string {
  const lines = hits.map((hit) => `- [${hit.sourceId}/${hit.chunkId}] (score: ${hit.score.toFixed(2)}) ${hit.content}`)
  return `## Retrieved Context (${meta.query})\n${lines.join('\n')}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

let retrievalOperationCounter = 0

async function runRetrievalOperation(args: {
  retrieverId: string
  namespace: string
  mode: RetrieverMode
  query: string
  limit?: number
  threshold?: number
  filter?: Record<string, unknown>
  fusion?: 'rrf' | 'dbsf'
  run: () => Promise<RetrieverHit[]>
}): Promise<RetrieverHit[]> {
  const startedAt = Date.now()
  const retrievalId = `${startedAt}-retrieval-${++retrievalOperationCounter}`
  const eventBase = {
    retrievalId,
    retrieverId: args.retrieverId,
    namespace: args.namespace,
    mode: args.mode,
    query: args.query,
    ...(args.limit !== undefined ? { limit: args.limit } : {}),
    ...(args.threshold !== undefined ? { threshold: args.threshold } : {}),
    ...(args.filter ? { filter: args.filter } : {}),
    ...(args.fusion ? { fusion: args.fusion } : {}),
  }

  getRuntime().instrumentationHooks?.onRetrievalStart?.(eventBase)
  const span = observe.openSpan({
    name: `${args.retrieverId}.retrieve`,
    family: 'retrieval',
    primitive: 'retrieval.query',
    attributes: eventBase,
  })

  try {
    const hits = await span.withContext(args.run)
    span.withContext(() => {
      emitRetrievalHitsArtifact(span.spanId, {
        ...eventBase,
        hits,
      })
    })
    span.end({ resultCount: hits.length })
    getRuntime().instrumentationHooks?.onRetrievalEnd?.({
      ...eventBase,
      resultCount: hits.length,
      durationMs: Date.now() - startedAt,
    })
    return hits
  } catch (error) {
    getRuntime().instrumentationHooks?.onRetrievalEnd?.({
      ...eventBase,
      resultCount: 0,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    })
    span.error(error, { resultCount: 0 })
    throw error
  }
}

function emitRetrievalHitsArtifact(
  spanId: ReturnType<typeof observe.openSpan>['spanId'],
  args: {
    retrievalId: string
    retrieverId: string
    pipelineId?: string
    namespace: string
    mode: RetrieverMode | 'pipeline'
    query: string
    limit?: number
    fusion?: 'rrf' | 'dbsf'
    stages?: readonly RetrievalStageTrace[]
    hits: readonly RetrieverHit[]
  },
): void {
  const artifactId = observe.artifact({
    kind: 'retrieval.hits',
    contentType: 'application/json',
    encoding: 'json',
    preview: {
      kind: 'retrieval.hits',
      query: args.query,
      mode: args.mode,
      ...(args.fusion ? { fusion: args.fusion } : {}),
      ...(args.limit !== undefined ? { limit: args.limit } : {}),
      returned: args.hits.length,
      resultCount: args.hits.length,
      hits: args.hits.slice(0, 10).map((hit, index) => retrievalHitPreview(hit, index)),
      ...(args.stages ? { stages: args.stages.map(retrievalStageReportPreview) } : {}),
    },
    attributes: {
      retrievalId: args.retrievalId,
      retrieverId: args.retrieverId,
      namespace: args.namespace,
      mode: args.mode,
      ...(args.pipelineId ? { pipelineId: args.pipelineId } : {}),
      ...(args.limit !== undefined ? { limit: args.limit } : {}),
      ...(args.fusion ? { fusion: args.fusion } : {}),
      returned: args.hits.length,
      resultCount: args.hits.length,
    },
  })
  if (artifactId) {
    observe.edge({
      edgeType: 'retrieval.returned',
      from: { kind: 'span', id: spanId },
      to: { kind: 'artifact', id: artifactId },
      attributes: {
        retrievalId: args.retrievalId,
        retrieverId: args.retrieverId,
        namespace: args.namespace,
        resultCount: args.hits.length,
      },
    })
  }
}

function emitStageOutputArtifact(
  spanId: ReturnType<typeof observe.openSpan>['spanId'],
  eventBase: {
    retrievalId: string
    retrieverId: string
    pipelineId: string
    stageName: string
    stageKind: string
    phase: string
  },
  preview: RetrievalStagePreview,
  attributes: Record<string, unknown>,
): void {
  const artifactId = observe.artifact({
    kind: 'output',
    contentType: 'application/json',
    encoding: 'json',
    preview,
    attributes: {
      ...eventBase,
      ...attributes,
      primitive: 'retrieval.stage',
    },
  })
  if (artifactId) {
    observe.edge({
      edgeType: 'produced',
      from: { kind: 'span', id: spanId },
      to: { kind: 'artifact', id: artifactId },
      attributes: { retrievalId: eventBase.retrievalId, stageName: eventBase.stageName, phase: eventBase.phase },
    })
  }
}

function retrievalHitPreview(hit: RetrieverHit, index: number): Record<string, unknown> {
  return {
    rank: index + 1,
    namespace: hit.namespace,
    sourceId: hit.sourceId,
    chunkId: hit.chunkId,
    score: hit.score,
    preview: hit.content.slice(0, 240),
    contentPreview: hit.content.slice(0, 240),
    ...(hit.sourceUrl ? { sourceUrl: hit.sourceUrl } : {}),
    ...(hit.sourcePath ? { sourcePath: hit.sourcePath } : {}),
    ...(hit.parent?.parentId ? { parentId: hit.parent.parentId } : {}),
  }
}

function retrievalStageReportPreview(stage: RetrievalStageTrace): Record<string, unknown> {
  return {
    name: stage.name,
    kind: stage.kind,
    phase: stage.phase,
    status: stage.status,
    ...(stage.inputHitCount !== undefined ? { inHits: stage.inputHitCount } : {}),
    ...(stage.outputHitCount !== undefined ? { outHits: stage.outputHitCount } : {}),
    ...(stage.inputQueryCount !== undefined ? { inQueries: stage.inputQueryCount } : {}),
    ...(stage.outputQueryCount !== undefined ? { outQueries: stage.outputQueryCount } : {}),
    ...(stage.warnings?.length ? { note: stage.warnings.join('; ') } : {}),
  }
}
