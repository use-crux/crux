/**
 * Batched, concurrent embedding execution.
 *
 * {@link createProviderBatchRunner} wraps a provider batch call with retry and
 * rate limiting (recording governance metrics); {@link createBatchExecutor}
 * splits inputs into chunks, runs them with bounded concurrency, and combines
 * the per-chunk usage/cost/governance. Internal helpers.
 *
 * @module
 */

import { combineCost, combineGovernance, combineUsage, compactGovernance } from './metrics'
import { createRateLimiter, runWithRetry } from './retry'
import type { BatchExecutionResult, EmbeddingGovernanceMetrics, NormalizedGovernance } from './types'

/** Wrap a provider batch call with retry + rate limiting and metric capture. */
export function createProviderBatchRunner<TInput, TOutput, TContext>(
  governance: NormalizedGovernance,
  runBatch: (inputs: readonly TInput[], context: TContext) => Promise<BatchExecutionResult<TOutput>>,
): (inputs: readonly TInput[], context: TContext) => Promise<BatchExecutionResult<TOutput>> {
  const limiter = governance.rateLimit ? createRateLimiter(governance.rateLimit.concurrency) : undefined

  return async (inputs, context) => {
    const metrics: EmbeddingGovernanceMetrics = {}
    const result = await runWithRetry(
      () =>
        limiter
          ? limiter.run(
              () => runBatch(inputs, context),
              (durationMs) => {
                metrics.rateLimitWaitMs = (metrics.rateLimitWaitMs ?? 0) + durationMs
              },
            )
          : runBatch(inputs, context),
      governance.retry,
      metrics,
    )
    return {
      ...result,
      governance: combineGovernance([result.governance, compactGovernance(metrics)]),
    }
  }
}

/** Split inputs into chunks, run with bounded concurrency, and combine results. */
export function createBatchExecutor<TInput, TOutput, TContext>(
  batch: Readonly<{ maxSize: number; concurrency: number }>,
  runBatch: (inputs: readonly TInput[], context: TContext) => Promise<BatchExecutionResult<TOutput>>,
): (inputs: readonly TInput[], context: TContext) => Promise<BatchExecutionResult<TOutput>> {
  return async (inputs, context): Promise<BatchExecutionResult<TOutput>> => {
    if (inputs.length === 0) {
      return { embeddings: [] }
    }

    const chunks = chunk(inputs, batch.maxSize)
    const results = new Array<BatchExecutionResult<TOutput>>(chunks.length)
    let nextIndex = 0

    const workers = Array.from({ length: Math.min(batch.concurrency, chunks.length) }, async () => {
      while (true) {
        const current = nextIndex
        nextIndex += 1
        if (current >= chunks.length) {
          return
        }
        results[current] = await runBatch(chunks[current], context)
      }
    })

    await Promise.all(workers)
    const embeddings = results.flatMap((result) => result.embeddings)
    if (embeddings.length !== inputs.length) {
      throw new Error(`Embedding provider returned ${embeddings.length} embeddings for ${inputs.length} inputs.`)
    }

    return {
      embeddings,
      usage: combineUsage(results.map((result) => result.usage)),
      cost: combineCost(results.map((result) => result.cost)),
      governance: combineGovernance(results.map((result) => result.governance)),
    }
  }
}

/** Split an array into fixed-size chunks. */
function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}
