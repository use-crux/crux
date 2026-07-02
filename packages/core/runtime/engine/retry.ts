/**
 * Runtime retry and dead-letter policy.
 *
 * The Runtime Engine owns logical retries independently of transport retries.
 * This module is pure so kernels and adapter conformance tests can assert the
 * same bounded full-jitter behavior without depending on a queue provider.
 *
 * @module
 */

import { CruxRuntimeError, type CruxRuntimeErrorCode } from './errors'

const DEFAULT_BASE_DELAY_MS = 1_000
const DEFAULT_MAX_DELAY_MS = 3_600_000
const DEFAULT_MAX_ATTEMPTS = 8
const MIN_JITTER = 0.5
const MAX_JITTER = 1

/** Options for calculating the retry delay for a failed delivery attempt. */
export interface RetryDelayOptions {
  /** One-based attempt number that just failed. */
  readonly attempt: number
  /** Deterministic random source for tests. Defaults to `Math.random`. */
  readonly rng?: () => number
  /** Initial exponential backoff delay. Defaults to 1 second. */
  readonly baseDelayMs?: number
  /** Upper bound before jitter is applied. Defaults to 1 hour. */
  readonly maxDelayMs?: number
}

/** Classification input for a failed runtime work attempt. */
export interface RuntimeFailureClassificationOptions extends RetryDelayOptions {
  /** Attempts allowed before the work becomes dead-lettered. Defaults to 8. */
  readonly maxAttempts?: number
}

/** Result of classifying a failed runtime work attempt. */
export type RuntimeFailureClassification =
  | { readonly kind: 'retry'; readonly delayMs: number }
  | { readonly kind: 'dead-letter' }
  | { readonly kind: 'terminal'; readonly code: CruxRuntimeErrorCode }

/**
 * Calculate bounded exponential full-jitter retry delay.
 *
 * The formula is `min(1h, 1s * 2 ** (attempt - 1)) * jitter`, where jitter is
 * uniformly mapped into `[0.5, 1.0]`.
 */
export function retryDelayMs(options: RetryDelayOptions): number {
  const rng = options.rng ?? Math.random
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS
  const exponent = Math.max(0, options.attempt - 1)
  const exponentialDelay = Math.min(maxDelayMs, baseDelayMs * 2 ** exponent)
  const jitter = MIN_JITTER + clampUnit(rng()) * (MAX_JITTER - MIN_JITTER)
  return Math.round(exponentialDelay * jitter)
}

/**
 * Classify a failed runtime work attempt.
 *
 * Public `CruxRuntimeError`s are terminal diagnostics: retrying the same code
 * will not fix a missing target, stale artifact, or non-JSON payload. Ordinary
 * thrown values are retried until `maxAttempts` is reached.
 */
export function classifyRuntimeFailure(
  error: unknown,
  options: RuntimeFailureClassificationOptions,
): RuntimeFailureClassification {
  if (error instanceof CruxRuntimeError) {
    return { kind: 'terminal', code: error.code }
  }

  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  if (options.attempt >= maxAttempts) {
    return { kind: 'dead-letter' }
  }

  return {
    kind: 'retry',
    delayMs: retryDelayMs(options),
  }
}

function clampUnit(value: number): number {
  if (Number.isNaN(value)) return 0
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}
