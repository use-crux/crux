import type { Guardrail, GuardrailContext } from './types'

// ── Types ──────────────────────────────────────────────────────────

export interface GuardrailEvalCase {
  /** The content to validate. */
  readonly input: string
  /** The expected action from the guard. */
  readonly expect: 'allow' | 'pass' | 'block' | 'rewrite' | 'redact' | 'transform' | 'warn'
}

export interface GuardrailEvalCaseResult {
  /** The input that was tested. */
  readonly input: string
  /** Whether the guard returned the expected action. */
  readonly passed: boolean
  /** The actual action returned by the guard. */
  readonly action: string
  /** The expected action. */
  readonly expected: string
  /** Duration of the guard check in milliseconds. */
  readonly durationMs: number
  /** Error message if the guard threw. */
  readonly error?: string
  /** Rewritten content when the guard transformed the input. */
  readonly output?: string
}

export interface GuardrailEvalReport {
  readonly results: readonly GuardrailEvalCaseResult[]
  readonly summary: {
    readonly total: number
    readonly passed: number
    readonly failed: number
  }
}

// ── Implementation ─────────────────────────────────────────────────

/**
 * Evaluate a guardrail against a matrix of test cases.
 *
 * Each case provides an input string and an expected action.
 * The guard is run against each case and the results are collected.
 *
 * ```typescript
 * const report = await evaluateGuardrail(piiGuard, [
 *   { input: 'SSN is 123-45-6789', expect: 'redact' },
 *   { input: 'Hello world', expect: 'pass' },
 * ])
 * ```
 */
export async function evaluateGuardrail(
  guard: Guardrail,
  cases: readonly GuardrailEvalCase[],
): Promise<GuardrailEvalReport> {
  const results: GuardrailEvalCaseResult[] = []

  const ctx: GuardrailContext = {
    phase: guard.phase,
    promptId: undefined,
    model: undefined,
    messages: [],
    systemPrompt: undefined,
    traceId: undefined,
    metadata: {},
  }

  for (const evalCase of cases) {
    const start = performance.now()

    try {
      const result = await guard.validate(evalCase.input, ctx)
      const durationMs = performance.now() - start
      const action = normalizeAction(result.action)

      results.push({
        input: evalCase.input,
        passed: action === normalizeAction(evalCase.expect),
        action: result.action,
        expected: evalCase.expect,
        durationMs,
        ...(result.action === 'redact' || result.action === 'transform' ? { output: result.content } : {}),
      })
    } catch (err) {
      const durationMs = performance.now() - start
      results.push({
        input: evalCase.input,
        passed: false,
        action: 'error',
        expected: evalCase.expect,
        durationMs,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const passed = results.filter((r) => r.passed).length
  const failed = results.filter((r) => !r.passed).length

  return {
    results,
    summary: {
      total: results.length,
      passed,
      failed,
    },
  }
}

function normalizeAction(action: string): string {
  if (action === 'pass') return 'allow'
  if (action === 'redact' || action === 'transform') return 'rewrite'
  return action
}
