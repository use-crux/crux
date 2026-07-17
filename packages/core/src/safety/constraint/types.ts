import type { z } from 'zod'
import type { SubjectOf } from '../boundary'
import type { SafetyRunContext } from '../decision'
import { SafetyResultError } from '../errors'
import type { ConstraintBoundary } from './boundary'

export type ConstraintSeverity = 'assert' | 'suggest'

/** Retryable semantic assertion result returned by constraints. */
export type ConstraintCheckResult =
  | { readonly pass: true; readonly metadata?: Readonly<Record<string, unknown>> }
  | { readonly pass: false; readonly feedback: string; readonly metadata?: Readonly<Record<string, unknown>> }

export type ChunkCheckResult = { readonly abort: false } | { readonly abort: true; readonly feedback: string }

/** Callable constraint body, optionally carrying first-party strategy metadata. */
export interface ConstraintRun<B extends ConstraintBoundary> {
  (subject: SubjectOf<B>, ctx: SafetyRunContext<B>): ConstraintCheckResult | Promise<ConstraintCheckResult>
  readonly strategy?: {
    readonly kind: string
    readonly config: Readonly<Record<string, unknown>>
  }
}

export interface ConstraintConfig<B extends ConstraintBoundary = ConstraintBoundary> {
  readonly id: string
  readonly on: B
  readonly category?: string
  readonly severity?: ConstraintSeverity
  readonly maxRetries?: number
  readonly run: ConstraintRun<B>
  readonly onChunk?: (
    chunk: string,
    accumulated: string,
    ctx: ConstraintContext,
  ) => ChunkCheckResult | Promise<ChunkCheckResult>
}

/** Frozen constraint object. */
export interface Constraint<B extends ConstraintBoundary = ConstraintBoundary> {
  readonly _tag: 'Constraint'
  readonly id: string
  readonly on: B
  readonly category: string | undefined
  readonly severity: ConstraintSeverity
  readonly maxRetries: number
  readonly run: ConstraintConfig<B>['run']
  readonly strategy?: {
    readonly kind: string
    readonly config: Readonly<Record<string, unknown>>
  }

  onChunk?(chunk: string, accumulated: string, ctx: ConstraintContext): ChunkCheckResult | Promise<ChunkCheckResult>
}

export interface ConstraintContext {
  readonly promptId: string | undefined
  readonly model: string | undefined
  readonly traceId: string | undefined
  readonly attempt: number
  readonly metadata: Readonly<Record<string, unknown>>
}

export interface ConstraintOutput<TSchema extends z.ZodType = z.ZodType<unknown>> {
  readonly text: string
  readonly parsed: z.infer<TSchema> | undefined
}

export interface ConstraintAuditEntry {
  readonly constraint: string
  readonly category?: string
  readonly severity: ConstraintSeverity
  readonly pass: boolean
  readonly feedback?: string
  readonly attempts: number
  readonly durationMs: number
  readonly metadata?: Readonly<Record<string, unknown>>
}

export interface ConstraintAudit {
  readonly entries: readonly ConstraintAuditEntry[]
  readonly allPassed: boolean
  readonly suggestFallback: boolean
}

export interface ConstraintFailure {
  readonly name: string
  readonly category?: string
  readonly severity: ConstraintSeverity
  readonly feedback: string
}

/** Validate a JS/unknown constraint result and fail closed on malformed values. */
export function validateConstraintRunResult(
  value: unknown,
  opts: { readonly policyId?: string; readonly boundary?: string },
): ConstraintCheckResult {
  if (!isRecord(value) || typeof value.pass !== 'boolean') {
    throw resultError(opts, 'result must be an object with a boolean pass field')
  }
  if (value.pass === true) {
    return {
      pass: true,
      ...(isMetadata(value.metadata) ? { metadata: value.metadata } : {}),
    }
  }
  if (typeof value.feedback !== 'string' || value.feedback.length === 0) {
    throw resultError(opts, 'failed constraint results require feedback')
  }
  return {
    pass: false,
    feedback: value.feedback,
    ...(isMetadata(value.metadata) ? { metadata: value.metadata } : {}),
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null
}

function isMetadata(value: unknown): value is Readonly<Record<string, unknown>> {
  return value === undefined || isRecord(value)
}

function resultError(
  opts: { readonly policyId?: string; readonly boundary?: string },
  problem: string,
): SafetyResultError {
  const policyId = opts.policyId ?? 'unknown'
  const boundary = opts.boundary ?? 'unknown'
  return new SafetyResultError({
    message: `Safety constraint "${policyId}" returned an invalid result: ${problem}.`,
    policyId,
    boundary,
    problem,
  })
}
