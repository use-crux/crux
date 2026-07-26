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
  rejectedCandidateEvidence,
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
 * Thrown when structured output fails Zod schema validation and no further
 * validation retry is available.
 *
 * Validation is unconditional: this is thrown even when `validationRetry` was
 * never configured, in which case `attempts` and `maxAttempts` are both `0` —
 * `attempts` counts validation *retries* performed, not the initial provider
 * attempt. Carries safe failure evidence, the Zod errors, attempt count, prompt
 * identifier, and a `validation.feedback` Safety decision. Raw failed model
 * output is intentionally not exposed on the public error.
 */
/** One content-free validation issue: where it failed and which rule failed. */
export interface ValidationIssueSummary {
  /**
   * Structural location of the failing value.
   *
   * @remarks
   * Object keys can be MODEL-CONTROLLED — a `z.record()` or catchall schema makes the
   * rejected payload's own keys become issue path segments — so raw keys are never
   * exposed. Static schema property names are kept because they come from the authored
   * schema; array indices are kept as `[i]`; anything else is a `*` placeholder.
   */
  readonly path: string
  /** Depth of the failing value, so a placeholder path is still locatable. */
  readonly depth: number
  /** Stable Zod issue code, such as `invalid_type`. */
  readonly code: string
}

/**
 * Project a `ZodError` down to stable, content-free `{ path, code }` pairs.
 *
 * Defensive by design: this runs while an error is being constructed, so a malformed or
 * foreign error object must degrade to an empty summary rather than throw and replace a
 * useful policy failure with a confusing one.
 */
function summarizeValidationIssues(error: z.ZodError): readonly ValidationIssueSummary[] {
  const issues = (error as { readonly issues?: unknown }).issues
  if (!Array.isArray(issues)) return []
  return issues.map((issue: unknown) => {
    const record = (issue ?? {}) as { readonly path?: unknown; readonly code?: unknown }
    const segments = Array.isArray(record.path) ? record.path : []
    return {
      path: safeIssuePath(segments),
      depth: segments.length,
      code: String(record.code ?? 'invalid'),
    }
  })
}

/** Static property names in the authored schema; anything else is not safe to echo. */
const SAFE_SEGMENT = /^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/

/**
 * Render an issue path without any model-controlled text.
 *
 * Array indices become `[i]`, identifier-shaped keys survive (they come from the authored
 * schema), and every other key — a record/catchall key derived from the rejected payload —
 * becomes `*`.
 */
function safeIssuePath(segments: readonly unknown[]): string {
  return segments
    .map((segment) => {
      if (typeof segment === 'number') return `[${segment}]`
      if (typeof segment === 'string' && SAFE_SEGMENT.test(segment)) return segment
      return '*'
    })
    .join('.')
}

/**
 * Rebuild a `ZodError` carrying only safe issue identity.
 *
 * A custom issue message is authored prose that can interpolate the rejected value, and
 * arbitrary custom issue fields can carry it outright, so neither is preserved.
 */
function sanitizeZodError(error: z.ZodError): z.ZodError {
  const issues = (error as { readonly issues?: unknown }).issues
  const safe = (Array.isArray(issues) ? issues : []).map((issue: unknown) => {
    const record = (issue ?? {}) as { readonly path?: unknown; readonly code?: unknown }
    const code = String(record.code ?? 'invalid')
    return {
      code,
      // Placeholder path only: record/catchall keys are model-controlled.
      path: safeIssuePath(Array.isArray(record.path) ? record.path : []).split('.').filter(Boolean),
      // The message is replaced by the code: an authored message can embed the value.
      message: code,
    } as unknown as z.core.$ZodIssue
  })
  try {
    return new (error.constructor as new (issues: z.core.$ZodIssue[]) => z.ZodError)(safe)
  } catch {
    // NEVER fall back to the original: reconstruction failing is not a reason to hand
    // back custom messages and arbitrary fields. Return an inert, structurally
    // compatible stand-in instead.
    return {
      name: 'ZodError',
      issues: safe,
      message: '[sanitized]',
    } as unknown as z.ZodError
  }
}

export class ValidationExhaustedError extends Error implements PolicyTerminalError {
  override readonly name = 'ValidationExhaustedError' as const
  readonly [POLICY_TERMINAL] = true

  /** Safe summary of the model output that failed validation. */
  readonly lastOutput: SafetyCaptureSummary

  /**
   * The Zod validation errors from the last attempt.
   *
   * @remarks
   * Sanitized: custom issue messages and arbitrary custom issue fields are dropped,
   * because a `superRefine` message can interpolate the rejected model output. Only
   * stable issue `path` and `code` survive. Use {@link issues} for the safe summary.
   */
  readonly zodErrors: z.ZodError

  /** Stable, content-free summary of what failed: one `{ path, code }` per issue. */
  readonly issues: readonly ValidationIssueSummary[]

  /**
   * Number of validation retries performed, not counting the initial provider
   * attempt. `0` when validation fails and no retry was configured.
   */
  readonly attempts: number

  /** Maximum validation retries configured; `0` when `validationRetry` is absent. */
  readonly maxAttempts: number

  /** Identifier of the prompt that was being generated. */
  readonly promptId: string

  /** Safety decision for the failed validation-feedback boundary. */
  readonly decisions: readonly SafetyDecision[]

  constructor(init: ValidationExhaustedErrorInit) {
    // Deliberately generic: `zodErrors.message` serializes issue messages, and a custom
    // refinement message can embed the rejected output verbatim. The safe issue summary
    // is exposed as `issues` instead.
    super(
      `Validation failed after ${init.attempts}/${init.maxAttempts} attempts for prompt "${init.promptId}".`,
    )
    this.lastOutput = rejectedCandidateEvidence(init.lastOutput ?? init.lastRawOutput ?? '')
    this.issues = summarizeValidationIssues(init.zodErrors)
    this.zodErrors = sanitizeZodError(init.zodErrors)
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
