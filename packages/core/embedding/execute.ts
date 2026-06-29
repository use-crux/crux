/**
 * The governed embedding execution pipeline.
 *
 * {@link runEmbeddingOperation} wraps an operation in an `embedding.call` span,
 * emits start/end hooks + the output artifact, and delegates to
 * {@link executeGovernedEmbedding}, which preprocesses/truncates inputs and either
 * calls the executor directly or routes through the embedding cache. Internal.
 *
 * @module
 */

import { observe } from '../observability'
import { getRuntime } from '../runtime/runtime'
import { embeddingCacheKey } from './cache'
import { combineGovernance, compactGovernance, eventGovernance } from './metrics'
import { emitEmbeddingOutputArtifact } from './observability'
import { applyPreprocessors, applyTruncation } from './preprocess'
import { hashString } from './hashing'
import type {
  BatchExecutionResult,
  CacheCodec,
  EmbeddingGovernanceMetrics,
  NormalizedGovernance,
} from './types'

let embeddingOperationCounter = 0

/** Run an embed/embedMany operation under a span, emitting hooks + artifact. */
export async function runEmbeddingOperation<T>(args: {
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


  try {
    const result = await span.withContext(async () => {
      const executionResult = await executeGovernedEmbedding(args)
      emitEmbeddingOutputArtifact(span.spanId, args, executionResult)
      return executionResult
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

/** Preprocess + truncate inputs, then execute directly or via the cache. */
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

/** Resolve cache hits, execute misses, persist them, and merge into one result. */
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
