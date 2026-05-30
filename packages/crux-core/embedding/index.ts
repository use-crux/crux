import type { CruxStore, EmbedFn, JsonObject, SparseVector } from '../store/types'
import { getRuntime } from '../runtime'
import { observe } from '../observability'

export interface EmbeddingUsage {
  inputTokens?: number
  totalTokens?: number
}

export interface EmbeddingGovernanceMetrics {
  cacheHitCount?: number
  cacheMissCount?: number
  retryCount?: number
  truncatedCount?: number
  rateLimitWaitMs?: number
}

export type DenseBatchResult =
  | number[][]
  | {
      embeddings: number[][]
      usage?: EmbeddingUsage
      cost?: number
    }

export type SparseBatchResult =
  | SparseVector[]
  | {
      embeddings: SparseVector[]
      usage?: EmbeddingUsage
      cost?: number
    }

interface EmbeddingBase {
  readonly _tag: 'Embedding'
  readonly name: string
  readonly maxInputTokens: number
  readonly batch: Readonly<{
    maxSize: number
    concurrency: number
  }>
}

type MaybePromise<T> = T | Promise<T>

export interface EmbeddingPreprocessor {
  readonly _tag: 'EmbeddingPreprocessor'
  readonly id: string
  readonly fingerprint: string
  run(text: string): MaybePromise<string>
}

export interface NormalizeTextOptions {
  trim?: boolean
  collapseWhitespace?: boolean
  lowercase?: boolean
}

export interface EmbeddingPreprocessorConfig {
  id: string
  fingerprint?: string
  run(text: string): MaybePromise<string>
}

export type EmbeddingPreprocessConfig = EmbeddingPreprocessor | readonly EmbeddingPreprocessor[]

export type EmbeddingTruncatePolicy =
  | { strategy?: 'fail' }
  | { strategy: 'chars'; maxChars: number }

export interface EmbeddingRetryPolicy {
  maxAttempts: number
  baseDelayMs?: number
  maxDelayMs?: number
  shouldRetry?: (error: unknown, attempt: number) => MaybePromise<boolean>
}

export interface EmbeddingRateLimitPolicy {
  concurrency: number
}

export interface EmbeddingCache {
  readonly _tag: 'EmbeddingCache'
  readonly namespace: string
  readonly ttlMs?: number
  get(key: string): Promise<JsonObject | null>
  set(key: string, value: JsonObject): Promise<void>
}

export interface EmbeddingCacheOptions {
  store: CruxStore
  namespace: string
  ttlMs?: number
}

export interface DenseEmbedding extends EmbeddingBase {
  readonly kind: 'dense'
  readonly dimensions: number
  embed(text: string): Promise<number[]>
  embedMany(texts: string[]): Promise<number[][]>
  asEmbedFn(): EmbedFn
}

export interface SparseEmbedding extends EmbeddingBase {
  readonly kind: 'sparse'
  embed(text: string): Promise<SparseVector>
  embedMany(texts: string[]): Promise<SparseVector[]>
}

export type CruxEmbedding = DenseEmbedding | SparseEmbedding

interface BatchExecutionResult<T> {
  embeddings: T[]
  usage?: EmbeddingUsage
  cost?: number
  governance?: EmbeddingGovernanceMetrics
}

interface EmbeddingGovernanceConfig {
  preprocess?: EmbeddingPreprocessConfig
  truncate?: EmbeddingTruncatePolicy
  retry?: EmbeddingRetryPolicy
  cache?: EmbeddingCache
  rateLimit?: EmbeddingRateLimitPolicy
  countTokens?: (text: string) => number
}

interface DenseEmbeddingConfig extends EmbeddingGovernanceConfig {
  kind: 'dense'
  name: string
  dimensions: number
  maxInputTokens: number
  batch: {
    maxSize: number
    concurrency?: number
  }
  embed(texts: string[]): Promise<DenseBatchResult>
}

interface SparseEmbeddingConfig extends EmbeddingGovernanceConfig {
  kind: 'sparse'
  name: string
  maxInputTokens: number
  batch: {
    maxSize: number
    concurrency?: number
  }
  embed(texts: string[]): Promise<SparseBatchResult>
}

interface CacheCodec<T> {
  kind: 'dense' | 'sparse'
  read(entry: JsonObject | null): T | undefined
  write(embedding: T): JsonObject
}

interface NormalizedGovernance {
  preprocessors: readonly EmbeddingPreprocessor[]
  truncate: EmbeddingTruncatePolicy
  retry?: EmbeddingRetryPolicy
  cache?: EmbeddingCache
  rateLimit?: EmbeddingRateLimitPolicy
  countTokens: (text: string) => number
  maxInputTokens: number
  fingerprint: string
}

interface RateLimiter {
  run<T>(fn: () => Promise<T>, onWait: (durationMs: number) => void): Promise<T>
}

export function embeddingPreprocessor(config: EmbeddingPreprocessorConfig): EmbeddingPreprocessor {
  if (!config.id.trim()) {
    throw new Error('Embedding preprocessor id must be non-empty.')
  }
  return Object.freeze({
    _tag: 'EmbeddingPreprocessor' as const,
    id: config.id,
    fingerprint: config.fingerprint ?? config.id,
    run: config.run,
  })
}

export function normalizeText(options: NormalizeTextOptions = {}): EmbeddingPreprocessor {
  const normalizedOptions = {
    trim: options.trim ?? false,
    collapseWhitespace: options.collapseWhitespace ?? false,
    lowercase: options.lowercase ?? false,
  }
  return embeddingPreprocessor({
    id: 'normalizeText',
    fingerprint: `normalizeText:${stableStringify(normalizedOptions)}`,
    run(text) {
      let value = text
      if (normalizedOptions.trim) {
        value = value.trim()
      }
      if (normalizedOptions.collapseWhitespace) {
        value = value.replace(/\s+/g, ' ')
      }
      if (normalizedOptions.lowercase) {
        value = value.toLowerCase()
      }
      return value
    },
  })
}

export function embeddingCache(options: EmbeddingCacheOptions): EmbeddingCache {
  if (!options.namespace.trim()) {
    throw new Error('Embedding cache namespace must be non-empty.')
  }
  const namespace = options.namespace.trim().replace(/:+$/g, '')
  if (!namespace) {
    throw new Error('Embedding cache namespace must be non-empty.')
  }
  return Object.freeze({
    _tag: 'EmbeddingCache' as const,
    namespace,
    ttlMs: options.ttlMs,
    get: (key: string) => options.store.get(key),
    set: (key: string, value: JsonObject) =>
      options.store.set(key, value, options.ttlMs === undefined ? undefined : { ttl: options.ttlMs }),
  })
}

export function embedding(config: DenseEmbeddingConfig): DenseEmbedding
export function embedding(config: SparseEmbeddingConfig): SparseEmbedding
export function embedding(config: DenseEmbeddingConfig | SparseEmbeddingConfig): CruxEmbedding {
  validateConfig(config)

  const batch = Object.freeze({
    maxSize: config.batch.maxSize,
    concurrency: config.batch.concurrency ?? 1,
  })
  const governance = normalizeGovernance(config)

  if (config.kind === 'dense') {
    const execute = createBatchExecutor<number[]>(
      batch,
      createProviderBatchRunner(governance, async (texts) => normalizeDenseResult(await config.embed(texts))),
    )
    const embedMany: DenseEmbedding['embedMany'] = async (texts) =>
      (
        await runEmbeddingOperation({
          name: config.name,
          kind: config.kind,
          operation: 'embedMany',
          dimensions: config.dimensions,
          texts,
          batch,
          governance,
          cacheCodec: denseCacheCodec,
          execute,
        })
      ).embeddings
    const embed: DenseEmbedding['embed'] = async (text) =>
      (
        await runEmbeddingOperation({
          name: config.name,
          kind: config.kind,
          operation: 'embed',
          dimensions: config.dimensions,
          texts: [text],
          batch,
          governance,
          cacheCodec: denseCacheCodec,
          execute,
        })
      ).embeddings[0]

    return Object.freeze({
      _tag: 'Embedding' as const,
      kind: 'dense' as const,
      name: config.name,
      dimensions: config.dimensions,
      maxInputTokens: config.maxInputTokens,
      batch,
      embed,
      embedMany,
      asEmbedFn: () => embed,
    })
  }

  const execute = createBatchExecutor<SparseVector>(
    batch,
    createProviderBatchRunner(governance, async (texts) => normalizeSparseResult(await config.embed(texts))),
  )
  const embedMany: SparseEmbedding['embedMany'] = async (texts) =>
    (
      await runEmbeddingOperation({
        name: config.name,
        kind: config.kind,
        operation: 'embedMany',
        texts,
        batch,
        governance,
        cacheCodec: sparseCacheCodec,
        execute,
      })
    ).embeddings
  const embed: SparseEmbedding['embed'] = async (text) =>
    (
      await runEmbeddingOperation({
        name: config.name,
        kind: config.kind,
        operation: 'embed',
        texts: [text],
        batch,
        governance,
        cacheCodec: sparseCacheCodec,
        execute,
      })
    ).embeddings[0]

  return Object.freeze({
    _tag: 'Embedding' as const,
    kind: 'sparse' as const,
    name: config.name,
    maxInputTokens: config.maxInputTokens,
    batch,
    embed,
    embedMany,
  })
}

function validateConfig(config: DenseEmbeddingConfig | SparseEmbeddingConfig): void {
  if (!config.name.trim()) {
    throw new Error('Embedding name must be non-empty.')
  }
  if (!Number.isFinite(config.maxInputTokens) || config.maxInputTokens <= 0) {
    throw new Error('Embedding maxInputTokens must be greater than 0.')
  }
  if (!Number.isInteger(config.batch.maxSize) || config.batch.maxSize <= 0) {
    throw new Error('Embedding batch.maxSize must be a positive integer.')
  }
  if (
    config.batch.concurrency !== undefined &&
    (!Number.isInteger(config.batch.concurrency) || config.batch.concurrency <= 0)
  ) {
    throw new Error('Embedding batch.concurrency must be a positive integer.')
  }
  if (config.kind === 'dense' && (!Number.isInteger(config.dimensions) || config.dimensions <= 0)) {
    throw new Error('Dense embedding dimensions must be a positive integer.')
  }
  if (config.truncate?.strategy === 'chars' && (!Number.isInteger(config.truncate.maxChars) || config.truncate.maxChars <= 0)) {
    throw new Error('Embedding truncate.maxChars must be a positive integer.')
  }
  if (config.retry !== undefined) {
    if (!Number.isInteger(config.retry.maxAttempts) || config.retry.maxAttempts <= 0) {
      throw new Error('Embedding retry.maxAttempts must be a positive integer.')
    }
    if (config.retry.baseDelayMs !== undefined && (!Number.isFinite(config.retry.baseDelayMs) || config.retry.baseDelayMs < 0)) {
      throw new Error('Embedding retry.baseDelayMs must be greater than or equal to 0.')
    }
    if (config.retry.maxDelayMs !== undefined && (!Number.isFinite(config.retry.maxDelayMs) || config.retry.maxDelayMs < 0)) {
      throw new Error('Embedding retry.maxDelayMs must be greater than or equal to 0.')
    }
  }
  if (
    config.rateLimit !== undefined &&
    (!Number.isInteger(config.rateLimit.concurrency) || config.rateLimit.concurrency <= 0)
  ) {
    throw new Error('Embedding rateLimit.concurrency must be a positive integer.')
  }
}

function normalizeDenseResult(result: DenseBatchResult): BatchExecutionResult<number[]> {
  return Array.isArray(result) ? { embeddings: result } : result
}

function normalizeSparseResult(result: SparseBatchResult): BatchExecutionResult<SparseVector> {
  return Array.isArray(result) ? { embeddings: result } : result
}

function normalizeGovernance(config: DenseEmbeddingConfig | SparseEmbeddingConfig): NormalizedGovernance {
  const preprocessors = normalizePreprocessors(config.preprocess)
  const truncate = config.truncate ?? { strategy: 'fail' as const }
  const countTokens = config.countTokens ?? estimateTokens
  const fingerprint = stableStringify({
    kind: config.kind,
    name: config.name,
    dimensions: config.kind === 'dense' ? config.dimensions : undefined,
    maxInputTokens: config.maxInputTokens,
    preprocessors: preprocessors.map((preprocessor) => preprocessor.fingerprint),
    truncate,
  })

  return {
    preprocessors,
    truncate,
    retry: config.retry,
    cache: config.cache,
    rateLimit: config.rateLimit,
    countTokens,
    maxInputTokens: config.maxInputTokens,
    fingerprint,
  }
}

function normalizePreprocessors(preprocess?: EmbeddingPreprocessConfig): readonly EmbeddingPreprocessor[] {
  if (!preprocess) {
    return []
  }
  return isEmbeddingPreprocessor(preprocess) ? [preprocess] : preprocess
}

function isEmbeddingPreprocessor(value: EmbeddingPreprocessConfig): value is EmbeddingPreprocessor {
  return '_tag' in value
}

function createProviderBatchRunner<T>(
  governance: NormalizedGovernance,
  runBatch: (texts: string[]) => Promise<BatchExecutionResult<T>>,
): (texts: string[]) => Promise<BatchExecutionResult<T>> {
  const limiter = governance.rateLimit ? createRateLimiter(governance.rateLimit.concurrency) : undefined

  return async (texts) => {
    const metrics: EmbeddingGovernanceMetrics = {}
    const result = await runWithRetry(
      () =>
        limiter
          ? limiter.run(() => runBatch(texts), (durationMs) => {
              metrics.rateLimitWaitMs = (metrics.rateLimitWaitMs ?? 0) + durationMs
            })
          : runBatch(texts),
      governance.retry,
      metrics,
    )
    return {
      ...result,
      governance: combineGovernance([result.governance, compactGovernance(metrics)]),
    }
  }
}

function createBatchExecutor<T>(
  batch: Readonly<{ maxSize: number; concurrency: number }>,
  runBatch: (texts: string[]) => Promise<BatchExecutionResult<T>>,
): (texts: string[]) => Promise<BatchExecutionResult<T>> {
  return async (texts: string[]): Promise<BatchExecutionResult<T>> => {
    if (texts.length === 0) {
      return { embeddings: [] }
    }

    const chunks = chunk(texts, batch.maxSize)
    const results = new Array<BatchExecutionResult<T>>(chunks.length)
    let nextIndex = 0

    const workers = Array.from({ length: Math.min(batch.concurrency, chunks.length) }, async () => {
      while (true) {
        const current = nextIndex
        nextIndex += 1
        if (current >= chunks.length) {
          return
        }
        results[current] = await runBatch(chunks[current])
      }
    })

    await Promise.all(workers)
    const embeddings = results.flatMap((result) => result.embeddings)
    if (embeddings.length !== texts.length) {
      throw new Error(`Embedding provider returned ${embeddings.length} embeddings for ${texts.length} inputs.`)
    }

    return {
      embeddings,
      usage: combineUsage(results.map((result) => result.usage)),
      cost: combineCost(results.map((result) => result.cost)),
      governance: combineGovernance(results.map((result) => result.governance)),
    }
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

let embeddingOperationCounter = 0

async function runEmbeddingOperation<T>(args: {
  name: string
  kind: 'dense' | 'sparse'
  operation: 'embed' | 'embedMany'
  texts: string[]
  batch: Readonly<{ maxSize: number; concurrency: number }>
  governance: NormalizedGovernance
  cacheCodec: CacheCodec<T>
  execute: (texts: string[]) => Promise<BatchExecutionResult<T>>
  dimensions?: number
}): Promise<BatchExecutionResult<T>> {
  const startedAt = Date.now()
  const embedId = `${startedAt}-embed-${++embeddingOperationCounter}`
  const eventBase = {
    embedId,
    name: args.name,
    kind: args.kind,
    operation: args.operation,
    inputCount: args.texts.length,
    chunkCount: args.texts.length === 0 ? 0 : Math.ceil(args.texts.length / args.batch.maxSize),
    maxChunkSize: args.texts.length === 0 ? 0 : Math.min(args.batch.maxSize, args.texts.length),
    ...(args.dimensions !== undefined ? { dimensions: args.dimensions } : {}),
  }
  const span = observe.openSpan({
    name: `${args.name}.${args.operation}`,
    family: 'embedding',
    primitive: 'embedding.call',
    attributes: {
      embedId,
      embeddingName: args.name,
      embeddingKind: args.kind,
      operation: args.operation,
      inputCount: args.texts.length,
      chunkCount: eventBase.chunkCount,
      maxChunkSize: eventBase.maxChunkSize,
      batchConcurrency: args.batch.concurrency,
      maxInputTokens: args.governance.maxInputTokens,
      preprocessorCount: args.governance.preprocessors.length,
      truncateStrategy: args.governance.truncate.strategy ?? 'fail',
      cacheEnabled: Boolean(args.governance.cache),
      ...(args.governance.cache ? { cacheNamespace: args.governance.cache.namespace } : {}),
      ...(args.dimensions !== undefined ? { dimensions: args.dimensions } : {}),
    },
  })

  getRuntime().instrumentationHooks?.onEmbedStart?.(eventBase)

  try {
    const result = await span.withContext(async () => {
      const executionResult = await executeGovernedEmbedding(args)
      emitEmbeddingOutputArtifact(span.spanId, args, executionResult)
      return executionResult
    })
    getRuntime().instrumentationHooks?.onEmbedEnd?.({
      ...eventBase,
      durationMs: Date.now() - startedAt,
      ...(result.usage ? { usage: result.usage } : {}),
      ...(result.cost !== undefined ? { cost: result.cost } : {}),
      ...eventGovernance(result.governance),
    })
    span.end({
      embeddingName: args.name,
      embeddingKind: args.kind,
      operation: args.operation,
      inputCount: args.texts.length,
      outputCount: result.embeddings.length,
      durationMs: Date.now() - startedAt,
      ...(result.usage?.inputTokens !== undefined ? { inputTokens: result.usage.inputTokens } : {}),
      ...(result.usage?.totalTokens !== undefined ? { totalTokens: result.usage.totalTokens } : {}),
      ...(result.cost !== undefined ? { cost: result.cost } : {}),
      ...eventGovernance(result.governance),
    })
    return result
  } catch (error) {
    getRuntime().instrumentationHooks?.onEmbedEnd?.({
      ...eventBase,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    })
    span.error(error, {
      embeddingName: args.name,
      embeddingKind: args.kind,
      operation: args.operation,
      inputCount: args.texts.length,
      durationMs: Date.now() - startedAt,
    })
    throw error
  }
}

async function executeGovernedEmbedding<T>(args: {
  name: string
  kind: 'dense' | 'sparse'
  dimensions?: number
  texts: string[]
  governance: NormalizedGovernance
  cacheCodec: CacheCodec<T>
  execute: (texts: string[]) => Promise<BatchExecutionResult<T>>
}): Promise<BatchExecutionResult<T>> {
  const metrics: EmbeddingGovernanceMetrics = {}
  const processedTexts = new Array<string>(args.texts.length)

  for (let index = 0; index < args.texts.length; index++) {
    const preprocessed = await applyPreprocessors(args.texts[index], args.governance.preprocessors)
    const truncated = applyTruncation(preprocessed, args.governance, metrics)
    processedTexts[index] = truncated
  }

  if (!args.governance.cache) {
    const result = await args.execute(processedTexts)
    return {
      ...result,
      governance: combineGovernance([metrics, result.governance]),
    }
  }

  return executeWithCache({
    ...args,
    texts: processedTexts,
    metrics,
  })
}

async function executeWithCache<T>(args: {
  name: string
  kind: 'dense' | 'sparse'
  dimensions?: number
  texts: string[]
  governance: NormalizedGovernance
  cacheCodec: CacheCodec<T>
  execute: (texts: string[]) => Promise<BatchExecutionResult<T>>
  metrics: EmbeddingGovernanceMetrics
}): Promise<BatchExecutionResult<T>> {
  const cache = args.governance.cache
  if (!cache) {
    return args.execute(args.texts)
  }

  const span = observe.openSpan({
    name: `${args.name}.embedding-cache`,
    family: 'cache',
    primitive: 'cache.lookup',
    attributes: {
      cacheKind: 'embedding',
      cacheOperation: 'lookup',
      cacheNamespace: cache.namespace,
      embeddingName: args.name,
      embeddingKind: args.kind,
      inputCount: args.texts.length,
      fingerprintHash: hashString(args.governance.fingerprint),
      ...(args.dimensions !== undefined ? { dimensions: args.dimensions } : {}),
    },
  })

  try {
    const result = await span.withContext(async () => {
      const embeddings = new Array<T>(args.texts.length)
      const misses = new Map<string, { key: string; text: string; indexes: number[] }>()

      for (let index = 0; index < args.texts.length; index++) {
        const text = args.texts[index]
        const key = embeddingCacheKey(cache.namespace, args.governance.fingerprint, text)
        const cached = args.cacheCodec.read(await cache.get(key))

        if (cached !== undefined) {
          embeddings[index] = cached
          args.metrics.cacheHitCount = (args.metrics.cacheHitCount ?? 0) + 1
          observe.event({
            name: 'embedding-cache.entry',
            attributes: { cacheKind: 'embedding', hit: true, inputIndex: index },
          })
          continue
        }

        args.metrics.cacheMissCount = (args.metrics.cacheMissCount ?? 0) + 1
        observe.event({
          name: 'embedding-cache.entry',
          attributes: { cacheKind: 'embedding', hit: false, inputIndex: index },
        })
        const existing = misses.get(key)
        if (existing) {
          existing.indexes.push(index)
        } else {
          misses.set(key, { key, text, indexes: [index] })
        }
      }

      if (misses.size === 0) {
        return {
          embeddings,
          governance: compactGovernance(args.metrics),
        }
      }

      const missEntries = [...misses.values()]
      const result = await args.execute(missEntries.map((entry) => entry.text))

      for (let index = 0; index < missEntries.length; index++) {
        const entry = missEntries[index]
        const embedding = result.embeddings[index]
        await cache.set(entry.key, args.cacheCodec.write(embedding))
        observe.event({
          name: 'embedding-cache.write',
          attributes: { cacheKind: 'embedding', outputIndexes: entry.indexes, cacheNamespace: cache.namespace },
        })
        for (const outputIndex of entry.indexes) {
          embeddings[outputIndex] = embedding
        }
      }

      return {
        embeddings,
        usage: result.usage,
        cost: result.cost,
        governance: combineGovernance([args.metrics, result.governance]),
      }
    })
    span.end({
      cacheKind: 'embedding',
      cacheOperation: 'lookup',
      cacheNamespace: cache.namespace,
      embeddingName: args.name,
      embeddingKind: args.kind,
      inputCount: args.texts.length,
      hitCount: args.metrics.cacheHitCount ?? 0,
      missCount: args.metrics.cacheMissCount ?? 0,
      allHit: (args.metrics.cacheHitCount ?? 0) === args.texts.length,
      writeCount: args.metrics.cacheMissCount ?? 0,
    })
    return result
  } catch (error) {
    span.error(error, {
      cacheKind: 'embedding',
      cacheOperation: 'lookup',
      cacheNamespace: cache.namespace,
      embeddingName: args.name,
      embeddingKind: args.kind,
      inputCount: args.texts.length,
      hitCount: args.metrics.cacheHitCount ?? 0,
      missCount: args.metrics.cacheMissCount ?? 0,
    })
    throw error
  }
}

function emitEmbeddingOutputArtifact<T>(
  spanId: ReturnType<typeof observe.openSpan>['spanId'],
  args: {
    name: string
    kind: 'dense' | 'sparse'
    operation: 'embed' | 'embedMany'
    dimensions?: number
  },
  result: BatchExecutionResult<T>,
): void {
  const artifactId = observe.artifact({
    kind: 'output',
    contentType: 'application/json',
    encoding: 'json',
    preview: {
      primitive: 'embedding.call',
      embeddingName: args.name,
      embeddingKind: args.kind,
      operation: args.operation,
      embeddingCount: result.embeddings.length,
      vectorValuesStored: false,
      ...(args.dimensions !== undefined ? { dimensions: args.dimensions } : {}),
      ...(result.usage ? { usage: result.usage } : {}),
      ...(result.cost !== undefined ? { cost: result.cost } : {}),
      ...embeddingShapePreview(result.embeddings, args.dimensions),
    },
    attributes: {
      primitive: 'embedding.call',
      embeddingName: args.name,
      embeddingKind: args.kind,
      operation: args.operation,
      embeddingCount: result.embeddings.length,
      vectorValuesStored: false,
      ...(args.dimensions !== undefined ? { dimensions: args.dimensions } : {}),
    },
  })
  if (!artifactId) return
  observe.edge({
    edgeType: 'produced',
    from: { kind: 'span', id: spanId },
    to: { kind: 'artifact', id: artifactId },
    attributes: { primitive: 'embedding.call', relation: 'embedding-output' },
  })
}

function embeddingShapePreview<T>(embeddings: readonly T[], configuredDimensions?: number): JsonObject {
  const first = embeddings[0]
  if (Array.isArray(first)) {
    return {
      dimensions: configuredDimensions ?? first.length,
      firstVectorLength: first.length,
    }
  }
  if (isSparseVector(first)) {
    return {
      sparseIndexCount: first.indices.length,
      sparseValueCount: first.values.length,
    }
  }
  return {}
}

async function applyPreprocessors(text: string, preprocessors: readonly EmbeddingPreprocessor[]): Promise<string> {
  let value = text
  for (const preprocessor of preprocessors) {
    value = await preprocessor.run(value)
  }
  return value
}

function applyTruncation(
  text: string,
  governance: NormalizedGovernance,
  metrics: EmbeddingGovernanceMetrics,
): string {
  if (governance.truncate.strategy === 'chars') {
    const truncated = text.length > governance.truncate.maxChars ? text.slice(0, governance.truncate.maxChars) : text
    if (truncated.length !== text.length) {
      metrics.truncatedCount = (metrics.truncatedCount ?? 0) + 1
    }
    return assertWithinTokenLimit(truncated, governance)
  }

  return assertWithinTokenLimit(text, governance)
}

function assertWithinTokenLimit(text: string, governance: NormalizedGovernance): string {
  const count = governance.countTokens(text)
  if (count > 0 && count > governance.maxInputTokens) {
    throw new Error(`Embedding input exceeds maxInputTokens (${count} > ${governance.maxInputTokens}).`)
  }
  return text
}

function combineUsage(usages: Array<EmbeddingUsage | undefined>): EmbeddingUsage | undefined {
  let inputTokens = 0
  let totalTokens = 0
  let hasInputTokens = false
  let hasTotalTokens = false

  for (const usage of usages) {
    if (!usage) continue
    if (usage.inputTokens !== undefined) {
      inputTokens += usage.inputTokens
      hasInputTokens = true
    }
    if (usage.totalTokens !== undefined) {
      totalTokens += usage.totalTokens
      hasTotalTokens = true
    }
  }

  if (!hasInputTokens && !hasTotalTokens) {
    return undefined
  }

  return {
    ...(hasInputTokens ? { inputTokens } : {}),
    ...(hasTotalTokens ? { totalTokens } : {}),
  }
}

function combineCost(costs: Array<number | undefined>): number | undefined {
  let total = 0
  let hasCost = false

  for (const cost of costs) {
    if (cost === undefined) continue
    total += cost
    hasCost = true
  }

  return hasCost ? total : undefined
}

function combineGovernance(metrics: Array<EmbeddingGovernanceMetrics | undefined>): EmbeddingGovernanceMetrics | undefined {
  const combined: EmbeddingGovernanceMetrics = {}
  for (const metric of metrics) {
    if (!metric) continue
    combined.cacheHitCount = addMetric(combined.cacheHitCount, metric.cacheHitCount)
    combined.cacheMissCount = addMetric(combined.cacheMissCount, metric.cacheMissCount)
    combined.retryCount = addMetric(combined.retryCount, metric.retryCount)
    combined.truncatedCount = addMetric(combined.truncatedCount, metric.truncatedCount)
    combined.rateLimitWaitMs = addMetric(combined.rateLimitWaitMs, metric.rateLimitWaitMs)
  }
  return compactGovernance(combined)
}

function compactGovernance(metrics: EmbeddingGovernanceMetrics): EmbeddingGovernanceMetrics | undefined {
  const compacted: EmbeddingGovernanceMetrics = {}
  if (metrics.cacheHitCount !== undefined) compacted.cacheHitCount = metrics.cacheHitCount
  if (metrics.cacheMissCount !== undefined) compacted.cacheMissCount = metrics.cacheMissCount
  if (metrics.retryCount !== undefined) compacted.retryCount = metrics.retryCount
  if (metrics.truncatedCount !== undefined) compacted.truncatedCount = metrics.truncatedCount
  if (metrics.rateLimitWaitMs !== undefined && metrics.rateLimitWaitMs > 0) {
    compacted.rateLimitWaitMs = metrics.rateLimitWaitMs
  }
  return Object.keys(compacted).length > 0 ? compacted : undefined
}

function eventGovernance(metrics?: EmbeddingGovernanceMetrics): EmbeddingGovernanceMetrics {
  return metrics ?? {}
}

function addMetric(left: number | undefined, right: number | undefined): number | undefined {
  if (right === undefined) {
    return left
  }
  return (left ?? 0) + right
}

async function runWithRetry<T>(
  fn: () => Promise<T>,
  retry: EmbeddingRetryPolicy | undefined,
  metrics: EmbeddingGovernanceMetrics,
): Promise<T> {
  const maxAttempts = retry?.maxAttempts ?? 1
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      if (attempt >= maxAttempts) {
        throw error
      }
      const shouldRetry = retry?.shouldRetry ? await retry.shouldRetry(error, attempt) : true
      if (!shouldRetry) {
        throw error
      }
      metrics.retryCount = (metrics.retryCount ?? 0) + 1
      const delayMs = retryDelayMs(retry, attempt)
      if (delayMs > 0) {
        await delay(delayMs)
      }
    }
  }
  throw new Error('Embedding retry loop exited unexpectedly.')
}

function retryDelayMs(retry: EmbeddingRetryPolicy | undefined, attempt: number): number {
  const baseDelayMs = retry?.baseDelayMs ?? 0
  const exponential = baseDelayMs * 2 ** (attempt - 1)
  return retry?.maxDelayMs === undefined ? exponential : Math.min(exponential, retry.maxDelayMs)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function createRateLimiter(concurrency: number): RateLimiter {
  let active = 0
  const queue: Array<() => void> = []

  async function acquire(): Promise<number> {
    if (active < concurrency) {
      active += 1
      return 0
    }

    const startedAt = Date.now()
    await new Promise<void>((resolve) => {
      queue.push(resolve)
    })
    active += 1
    return Date.now() - startedAt
  }

  function release(): void {
    active -= 1
    const next = queue.shift()
    if (next) {
      next()
    }
  }

  return {
    async run<T>(fn: () => Promise<T>, onWait: (durationMs: number) => void): Promise<T> {
      const waitMs = await acquire()
      if (waitMs > 0) {
        onWait(waitMs)
      }
      try {
        return await fn()
      } finally {
        release()
      }
    },
  }
}

function embeddingCacheKey(namespace: string, governanceFingerprint: string, text: string): string {
  return `${namespace}:v1:${hashString(governanceFingerprint)}:${hashString(text)}`
}

const denseCacheCodec: CacheCodec<number[]> = {
  kind: 'dense',
  read(entry) {
    if (!entry || entry.kind !== 'dense' || !isNumberArray(entry.embedding)) {
      return undefined
    }
    return entry.embedding
  },
  write(embedding) {
    return {
      _tag: 'EmbeddingCacheEntry',
      kind: 'dense',
      embedding,
      createdAt: Date.now(),
    }
  },
}

const sparseCacheCodec: CacheCodec<SparseVector> = {
  kind: 'sparse',
  read(entry) {
    if (!entry || entry.kind !== 'sparse' || !isSparseVector(entry.embedding)) {
      return undefined
    }
    return entry.embedding
  },
  write(embedding) {
    return {
      _tag: 'EmbeddingCacheEntry',
      kind: 'sparse',
      embedding,
      createdAt: Date.now(),
    }
  },
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'number')
}

function isSparseVector(value: unknown): value is SparseVector {
  if (!isRecord(value)) {
    return false
  }
  return isNumberArray(value.indices) && isNumberArray(value.values)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function estimateTokens(text: string): number {
  const trimmed = text.trim()
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`
}

function hashString(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
