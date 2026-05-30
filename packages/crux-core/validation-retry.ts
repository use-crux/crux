/**
 * Validation-feedback retry types and error class.
 *
 * Used by adapter `generate()` to retry structured output that fails
 * Zod validation, injecting the error back into the conversation for
 * the model to self-correct.
 *
 * @module
 */

import type { z } from 'zod'

// ── Options ────────────────────────────────────────────────────────

/** Configuration for validation-feedback retry on structured output. */
export interface ValidationRetryOptions {
  /**
   * Maximum number of validation retries.
   * Each retry consumes one step from the shared `maxSteps` budget.
   * @default 3
   */
  readonly maxRetries?: number

  /** Called on each validation retry attempt (for logging/metrics). */
  readonly onRetry?: (attempt: number, error: z.ZodError) => void

  /** Called when all validation retries are exhausted. */
  readonly onExhausted?: (attempts: number, lastError: z.ZodError) => void
}

// ── Error ──────────────────────────────────────────────────────────

/** Constructor arguments for {@link ValidationExhaustedError}. */
export interface ValidationExhaustedErrorInit {
  readonly lastRawOutput: string
  readonly zodErrors: z.ZodError
  readonly attempts: number
  readonly maxAttempts: number
  readonly promptId: string
}

/**
 * Thrown when all validation retries are exhausted and the model's
 * structured output still fails Zod schema validation.
 *
 * Carries enough context for debugging: the last raw output,
 * the Zod errors, attempt count, and prompt identifier.
 */
export class ValidationExhaustedError extends Error {
  override readonly name = 'ValidationExhaustedError' as const

  /** The model's last raw text output that failed validation. */
  readonly lastRawOutput: string

  /** The Zod validation errors from the last attempt. */
  readonly zodErrors: z.ZodError

  /** Number of validation retry attempts made. */
  readonly attempts: number

  /** Maximum validation retries that were configured. */
  readonly maxAttempts: number

  /** Identifier of the prompt that was being generated. */
  readonly promptId: string

  constructor(init: ValidationExhaustedErrorInit) {
    super(
      `Validation failed after ${init.attempts}/${init.maxAttempts} attempts for prompt "${init.promptId}": ${init.zodErrors.message}`,
    )
    this.lastRawOutput = init.lastRawOutput
    this.zodErrors = init.zodErrors
    this.attempts = init.attempts
    this.maxAttempts = init.maxAttempts
    this.promptId = init.promptId
  }
}

// ── Type guard ─────────────────────────────────────────────────────

/** Type guard for `ValidationExhaustedError`. */
export function isValidationExhaustedError(error: unknown): error is ValidationExhaustedError {
  return error instanceof ValidationExhaustedError
}
