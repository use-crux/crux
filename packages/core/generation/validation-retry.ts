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
import type { SafetyCaptureSummary, SafetyDecision } from '../safety/decision'
import {
  POLICY_TERMINAL,
  toSafetyCaptureSummary,
  type PolicyTerminalError,
} from '../safety/errors'

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
  readonly lastRawOutput?: string
  readonly lastOutput?: SafetyCaptureSummary
  readonly decisions?: readonly SafetyDecision[]
  readonly zodErrors: z.ZodError
  readonly attempts: number
  readonly maxAttempts: number
  readonly promptId: string
}

/**
 * Thrown when all validation retries are exhausted and the model's
 * structured output still fails Zod schema validation.
 *
 * Carries safe failure evidence, the Zod errors, attempt count, prompt
 * identifier, and a `validation.feedback` Safety decision. Raw failed model
 * output is intentionally not exposed on the public error.
 */
export class ValidationExhaustedError extends Error implements PolicyTerminalError {
  override readonly name = 'ValidationExhaustedError' as const
  readonly [POLICY_TERMINAL] = true

  /** Safe summary of the model output that failed validation. */
  readonly lastOutput: SafetyCaptureSummary

  /** The Zod validation errors from the last attempt. */
  readonly zodErrors: z.ZodError

  /** Number of validation retry attempts made. */
  readonly attempts: number

  /** Maximum validation retries that were configured. */
  readonly maxAttempts: number

  /** Identifier of the prompt that was being generated. */
  readonly promptId: string

  /** Safety decision for the failed validation-feedback boundary. */
  readonly decisions: readonly SafetyDecision[]

  constructor(init: ValidationExhaustedErrorInit) {
    super(
      `Validation failed after ${init.attempts}/${init.maxAttempts} attempts for prompt "${init.promptId}": ${init.zodErrors.message}`,
    )
    this.lastOutput = init.lastOutput ?? toSafetyCaptureSummary(init.lastRawOutput ?? '')
    this.zodErrors = init.zodErrors
    this.attempts = init.attempts
    this.maxAttempts = init.maxAttempts
    this.promptId = init.promptId
    this.decisions = init.decisions ?? [
      validationFeedbackDecision({
        captured: this.lastOutput,
        reason: 'validation retries exhausted',
      }),
    ]
  }
}

// ── Type guard ─────────────────────────────────────────────────────

/** Type guard for `ValidationExhaustedError`. */
export function isValidationExhaustedError(error: unknown): error is ValidationExhaustedError {
  return error instanceof ValidationExhaustedError
}

function validationFeedbackDecision(input: {
  readonly captured: SafetyCaptureSummary
  readonly reason: string
}): SafetyDecision {
  return {
    policyId: 'validation.feedback',
    kind: 'guardrail',
    boundary: 'validation.feedback',
    mode: 'enforce',
    action: 'block',
    reason: input.reason,
    durationMs: 0,
    captured: input.captured,
  }
}
