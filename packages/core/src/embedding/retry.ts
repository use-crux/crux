/**
 * Resilience primitives for embedding provider calls.
 *
 * {@link runWithRetry} retries a batch with exponential backoff (recording retry
 * count); {@link createRateLimiter} bounds concurrency and reports queue wait
 * time. Internal helpers.
 *
 * @module
 */

import type { EmbeddingGovernanceMetrics, EmbeddingRetryPolicy, RateLimiter } from './types'

/** Run a function with the retry policy, counting retries into `metrics`. */
export async function runWithRetry<T>(
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

/** Compute the exponential backoff delay for an attempt, capped by maxDelayMs. */
function retryDelayMs(retry: EmbeddingRetryPolicy | undefined, attempt: number): number {
  const baseDelayMs = retry?.baseDelayMs ?? 0
  const exponential = baseDelayMs * 2 ** (attempt - 1)
  return retry?.maxDelayMs === undefined ? exponential : Math.min(exponential, retry.maxDelayMs)
}

/** Resolve after `ms` milliseconds. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Create a concurrency limiter that reports per-acquire queue wait time. */
export function createRateLimiter(concurrency: number): RateLimiter {
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
