/**
 * Model fallback primitive — wraps multiple models into a single reference
 * that tries each in order on qualifying failure.
 *
 * @module
 */

import { isValidationExhaustedError } from './validation-retry'

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

/** Error categories that can trigger a fallback attempt. */
export type ErrorCategory =
  | 'rate_limit'
  | 'timeout'
  | 'server_error'
  | 'connection_error'
  | 'auth_error'
  | 'validation_exhausted'

/** Options for configuring fallback behavior. */
export interface FallbackOptions {
  /** Stable id used to join authored index definitions with fallback attempt spans. */
  id?: string
  /** Human-readable description for index and devtools surfaces. */
  description?: string
  /** Which error categories trigger fallback. Defaults to all categories. */
  on?: ErrorCategory[]
  /** Custom predicate — when set, takes priority over `on`. */
  shouldFallback?: (error: Error) => boolean
  /** Per-attempt timeout in milliseconds. Uses AbortController internally. */
  timeout?: number
  /** Called when an attempt fails (before trying the next model). */
  onAttemptError?: (error: Error, attempt: number, model: unknown) => void
}

/** A fallback model wrapper — recognized by adapters via `isFallback()`. */
export interface FallbackModel<M = unknown> {
  readonly _tag: 'crux.fallback'
  readonly models: readonly M[]
  readonly options: FallbackOptions
}

/** Metadata about a single fallback attempt. */
export interface FallbackAttemptDetail {
  model: string
  durationMs: number
  status: 'success' | 'error'
  error?: string
  errorCategory?: ErrorCategory | null
  cost?: number
}

/** Metadata attached to `_meta.fallback` on successful fallback results. */
export interface FallbackMeta {
  /** Total number of attempts (including the successful one). */
  attempts: number
  /** Model IDs that failed before the successful one. */
  failedModels: string[]
  /** Per-attempt details. */
  details: FallbackAttemptDetail[]
}

// ─────────────────────────────────────────────────────────────────
// fallback()
// ─────────────────────────────────────────────────────────────────

/**
 * Create a fallback model wrapper that tries models in order.
 *
 * Pass 2+ models, optionally followed by an options object.
 *
 * @example
 * ```ts
 * import { fallback } from '@crux/core'
 *
 * const model = fallback(gpt4o, claudeSonnet, geminiFlash)
 *
 * const model = fallback(gpt4o, claudeSonnet, {
 *   on: ['rate_limit', 'timeout'],
 *   timeout: 10_000,
 * })
 * ```
 */
export function fallback<M>(...args: [...M[], FallbackOptions] | M[]): FallbackModel<M> {
  // Separate options from models
  let models: M[]
  let options: FallbackOptions = {}

  const lastArg = args[args.length - 1]
  if (lastArg !== null && typeof lastArg === 'object' && !isModel(lastArg)) {
    options = lastArg as FallbackOptions
    models = args.slice(0, -1) as M[]
  } else {
    models = args as M[]
  }

  if (models.length < 2) {
    throw new Error('fallback() requires at least 2 models')
  }

  return Object.freeze({
    _tag: 'crux.fallback' as const,
    models: Object.freeze([...models]),
    options,
  })
}

/** Type guard — returns `true` if the model is a `FallbackModel` wrapper. */
export function isFallback(model: unknown): model is FallbackModel {
  return (
    model !== null &&
    model !== undefined &&
    typeof model === 'object' &&
    '_tag' in model &&
    (model as { _tag: unknown })._tag === 'crux.fallback'
  )
}

// ─────────────────────────────────────────────────────────────────
// classifyError()
// ─────────────────────────────────────────────────────────────────

/**
 * Classify an error into a fallback error category.
 *
 * Returns `null` if the error doesn't match any known category
 * (e.g., validation errors, content policy violations).
 */
export function classifyError(error: unknown): ErrorCategory | null {
  if (!(error instanceof Error)) return null

  // Validation exhaustion (all retries failed on structured output)
  if (isValidationExhaustedError(error)) return 'validation_exhausted'

  // Check HTTP status codes (works with OpenAI APIError, Anthropic errors, etc.)
  const errShape = error as { status?: unknown; statusCode?: unknown; code?: unknown }
  const status = errShape.status ?? errShape.statusCode
  if (typeof status === 'number') {
    if (status === 429) return 'rate_limit'
    if (status === 401 || status === 403) return 'auth_error'
    if (status >= 500 && status < 600) return 'server_error'
    // 4xx errors (400, 404, 422, etc.) are not retryable
    return null
  }

  // Check error codes (Node.js system errors)
  const code = errShape.code
  if (typeof code === 'string') {
    if (code === 'ETIMEDOUT' || code === 'TIMEOUT') return 'timeout'
    if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ECONNRESET') {
      return 'connection_error'
    }
  }

  // AbortError (from AbortController timeout)
  if (error.name === 'AbortError') return 'timeout'

  // fetch TypeError ("fetch failed", "network error")
  if (error instanceof TypeError && /fetch failed|network/i.test(error.message)) {
    return 'connection_error'
  }

  return null
}

/**
 * Check whether an error should trigger fallback based on options.
 *
 * If `shouldFallback` predicate is set, it takes priority.
 * Otherwise checks `on` categories (defaults to all categories if `on` is not set).
 */
export function shouldAttemptFallback(error: Error, options: FallbackOptions): boolean {
  // Custom predicate takes priority
  if (options.shouldFallback) {
    return options.shouldFallback(error)
  }

  const category = classifyError(error)
  if (category === null) return false

  // If `on` is specified, only those categories trigger fallback
  if (options.on && options.on.length > 0) {
    return options.on.includes(category)
  }

  // Default: all classified errors trigger fallback
  return true
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

/**
 * Heuristic to distinguish model objects from options objects.
 * Models are SDK objects (with provider/modelId) or strings; options have our known keys.
 */
function isModel(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return true
  const obj = value as Record<string, unknown>

  // If it has _tag it's a crux object (Context, Prompt, etc.) — not options
  if ('_tag' in obj) return true

  // If it has provider/modelId it's a model info object
  if ('provider' in obj && 'modelId' in obj) return true

  // Only a pure FallbackOptions-shaped object is options. Real model objects may
  // also expose common metadata fields such as id or description.
  const optionKeys = ['id', 'description', 'on', 'shouldFallback', 'timeout', 'onAttemptError']
  return !Object.keys(obj).every((key) => optionKeys.includes(key))
}
