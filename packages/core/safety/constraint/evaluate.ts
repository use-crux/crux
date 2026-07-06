import type { Constraint, ConstraintContext } from './types'

// ── Types ──────────────────────────────────────────────────────────

export interface ConstraintEvalCase {
  /** The output to validate (text + optional parsed object). */
  readonly input: { readonly text: string; readonly parsed?: unknown }
  /** Whether the constraint should pass on this input. */
  readonly expect: boolean
  /** Optional label for the test case. */
  readonly name?: string
}

export interface ConstraintEvalCaseResult {
  readonly input: { readonly text: string }
  readonly expectedPass: boolean
  readonly actualPass: boolean
  readonly matched: boolean
  readonly feedback?: string
  readonly metadata?: Readonly<Record<string, unknown>>
  readonly durationMs: number
  readonly error?: string
}

export interface ConstraintEvalReport {
  readonly results: readonly ConstraintEvalCaseResult[]
  readonly summary: {
    readonly total: number
    readonly passed: number
    readonly failed: number
  }
}

// ── Implementation ─────────────────────────────────────────────────

/**
 * Evaluate a constraint against a matrix of test cases.
 *
 * Each case provides an output (text + optional parsed) and an expected pass/fail.
 * The constraint is run against each case and the results are collected.
 *
 * ```typescript
 * const report = await evaluateConstraint(citeSources, [
 *   { input: { text: 'See [1] and [2]' }, expect: true },
 *   { input: { text: 'No citations here' }, expect: false },
 * ])
 * ```
 */
export async function evaluateConstraint(
  constraint: Constraint,
  cases: readonly ConstraintEvalCase[],
): Promise<ConstraintEvalReport> {
  const results: ConstraintEvalCaseResult[] = []

  const ctx: ConstraintContext = {
    promptId: undefined,
    model: undefined,
    traceId: undefined,
    attempt: 0,
    metadata: {},
  }

  for (const evalCase of cases) {
    const start = performance.now()

    try {
      const result = await constraint.check(
        { text: evalCase.input.text, parsed: evalCase.input.parsed },
        ctx,
      )
      const durationMs = performance.now() - start

      results.push({
        input: { text: evalCase.input.text },
        expectedPass: evalCase.expect,
        actualPass: result.pass,
        matched: result.pass === evalCase.expect,
        feedback: result.pass ? undefined : result.feedback,
        metadata: result.metadata,
        durationMs,
      })
    } catch (err) {
      const durationMs = performance.now() - start
      results.push({
        input: { text: evalCase.input.text },
        expectedPass: evalCase.expect,
        actualPass: false,
        matched: false,
        durationMs,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const passed = results.filter((r) => r.matched).length
  const failed = results.filter((r) => !r.matched).length

  return {
    results,
    summary: {
      total: results.length,
      passed,
      failed,
    },
  }
}
