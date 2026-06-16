import type { z } from 'zod'

// ── Severity ──────────────────────────────────────────────────────

export type ConstraintSeverity = 'assert' | 'suggest'

// ── Check Result (discriminated union — compiler enforces feedback on failure) ─

export type ConstraintCheckResult =
  | { readonly pass: true; readonly metadata?: Readonly<Record<string, unknown>> }
  | { readonly pass: false; readonly feedback: string; readonly metadata?: Readonly<Record<string, unknown>> }

// ── Chunk Check Result (discriminated union — feedback required on abort) ──

export type ChunkCheckResult = { readonly abort: false } | { readonly abort: true; readonly feedback: string }

// ── Context ───────────────────────────────────────────────────────

export interface ConstraintContext {
  readonly promptId: string | undefined
  readonly model: string | undefined
  readonly traceId: string | undefined
  readonly attempt: number
  readonly metadata: Readonly<Record<string, unknown>>
}

// ── Output (what the check function receives) ─────────────────────

export interface ConstraintOutput<TSchema extends z.ZodType = z.ZodType<unknown>> {
  readonly text: string
  readonly parsed: z.infer<TSchema> | undefined
}

// ── Config ────────────────────────────────────────────────────────

/**
 * Configuration for `constraint()`.
 *
 * Default generic is `z.ZodType<unknown>` (not `z.ZodType`) to prevent
 * `output.parsed` from silently resolving to `any`. Provide a schema type
 * for full compile-time safety on the parsed output.
 */
export interface ConstraintConfig<TSchema extends z.ZodType = z.ZodType<unknown>> {
  readonly name: string
  /**
   * Optional risk-category label (e.g. `'grounding'`, `'brand'`, `'pii'`).
   * Carried through audit entries and observability artifacts so devtools
   * and reporting can aggregate by risk type instead of by policy name.
   */
  readonly category?: string
  readonly severity?: ConstraintSeverity
  readonly maxRetries?: number
  readonly check: (
    output: ConstraintOutput<TSchema>,
    ctx: ConstraintContext,
  ) => ConstraintCheckResult | Promise<ConstraintCheckResult>
  readonly onChunk?: (
    chunk: string,
    accumulated: string,
    ctx: ConstraintContext,
  ) => ChunkCheckResult | Promise<ChunkCheckResult>
}

// ── Frozen Constraint Object ──────────────────────────────────────

export interface Constraint<TSchema extends z.ZodType = z.ZodType<unknown>> {
  readonly _tag: 'Constraint'
  readonly name: string
  readonly category: string | undefined
  readonly severity: ConstraintSeverity
  readonly maxRetries: number
  readonly check: ConstraintConfig<TSchema>['check']
  readonly onChunk: ConstraintConfig<TSchema>['onChunk'] | undefined
}

// ── Audit ─────────────────────────────────────────────────────────

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
  /** true when only suggest constraints failed — output is best-effort */
  readonly suggestFallback: boolean
}

// ── Failure detail (consumed by ConstraintFeedbackFormatter) ──────

/** One failing constraint from a check round, as handed to the corrective-feedback formatter. */
export interface ConstraintFailure {
  readonly name: string
  readonly category: string | undefined
  readonly severity: ConstraintSeverity
  readonly feedback: string
}
