/**
 * Shared retry utility — used by both `flow()` steps and composition
 * patterns (parallel, pipeline, consensus, swarm) for per-step/per-agent
 * retry with backoff and fallback.
 *
 * @module
 */

import { observe } from '../observability'
import { isPolicyTerminal } from '../safety/errors'

// ── Types ───────────────────────────────────────────────────────────

/** Retry and fallback configuration for a step or agent execution. */
export interface RetryOptions {
  /** Retry configuration for failed executions. */
  retry?: {
    /** Maximum number of attempts (including the first). */
    attempts: number
    /** Base delay between retries in milliseconds. Defaults to `1000`. */
    delay?: number
    /** Backoff strategy. `'linear'` multiplies delay by attempt number, `'exponential'` uses powers of 2. */
    backoff?: 'linear' | 'exponential'
  }
  /**
   * Override retry eligibility. By default Crux retries ordinary execution
   * failures, but never retries policy-terminal errors such as blocked
   * guardrails, exhausted validation, or constraint violations.
   */
  shouldRetry?: (error: unknown, context: RetryDecisionContext) => boolean
  /** Fallback function to run if all retry attempts fail. */
  fallback?: () => Promise<unknown> | unknown
}

export interface RetryDecisionContext {
  /** 1-based attempt number that just failed. */
  attempt: number
  /** Configured maximum attempts. */
  maxAttempts: number
}

// ── Implementation ──────────────────────────────────────────────────

export function isNonRetryableCruxPolicyError(error: unknown): boolean {
  return isPolicyTerminal(error)
}

/**
 * Execute a function with retry and optional fallback.
 *
 * @param fn - The function to execute.
 * @param options - Optional retry/fallback configuration.
 * @returns The result of the function (or fallback).
 *
 * @example
 * ```ts
 * const result = await executeWithRetry(
 *   () => generate(prompt, { model, input }),
 *   { retry: { attempts: 3, backoff: 'exponential' }, fallback: () => 'default' }
 * )
 * ```
 */
export async function executeWithRetry<T>(fn: () => Promise<T> | T, options?: RetryOptions): Promise<T> {
  const attempts = options?.retry?.attempts ?? 1
  const baseDelay = options?.retry?.delay ?? 1000
  const backoff = options?.retry?.backoff ?? 'linear'

  let lastError: unknown
  for (let i = 0; i < attempts; i++) {
    observe.event({
      name: 'retry.attempt',
      attributes: { attempt: i + 1, maxAttempts: attempts },
    })
    try {
      const result = await fn()
      if (i > 0) {
        observe.event({
          name: 'retry.recovered',
          attributes: { attempt: i + 1, maxAttempts: attempts },
        })
      }
      return result
    } catch (err) {
      lastError = err
      const attempt = i + 1
      const errorName = err instanceof Error ? err.name : typeof err
      observe.event({
        name: 'retry.error',
        attributes: {
          attempt,
          maxAttempts: attempts,
          errorName,
          error: err instanceof Error ? err.message : String(err),
        },
      })
      const retryableByDefault = !isNonRetryableCruxPolicyError(err)
      const shouldRetry = options?.shouldRetry?.(err, { attempt, maxAttempts: attempts }) ?? retryableByDefault
      if (!shouldRetry) {
        observe.event({
          name: 'retry.skipped',
          attributes: {
            attempt,
            maxAttempts: attempts,
            errorName,
            reason: retryableByDefault ? 'caller-decision' : 'crux-policy-terminal',
          },
        })
        throw err
      }
      if (i < attempts - 1) {
        const multiplier = backoff === 'exponential' ? Math.pow(2, i) : i + 1
        const delayMs = baseDelay * multiplier
        observe.event({
          name: 'retry.delay',
          attributes: { attempt: i + 1, delayMs, backoff },
        })
        await new Promise((r) => setTimeout(r, delayMs))
      }
    }
  }

  if (options?.fallback) {
    observe.event({
      name: 'retry.fallback',
      attributes: { maxAttempts: attempts },
    })
    return (await options.fallback()) as T
  }

  throw lastError
}
