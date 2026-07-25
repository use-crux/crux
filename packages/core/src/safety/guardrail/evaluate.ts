import { selectedPath } from '../boundary'
import type { BoundaryDef } from '../boundary'
import { isMediaSafetyTargetId } from '../boundary'
import type { SafetyRunContext } from '../decision'
import { SafetyConfigError } from '../errors'
import type { Guardrail } from './types'
import { validateGuardrailRunResult } from './types'

// ── Types ──────────────────────────────────────────────────────────

export interface GuardrailEvalCase {
  /** The content to validate. */
  readonly input: string
  /** The expected action from the guard. */
  readonly expect: 'allow' | 'block' | 'rewrite' | 'warn'
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
 *   { input: 'SSN is 123-45-6789', expect: 'rewrite' },
 *   { input: 'Hello world', expect: 'allow' },
 * ])
 * ```
 */
export async function evaluateGuardrail(
  guard: Guardrail,
  cases: readonly GuardrailEvalCase[],
): Promise<GuardrailEvalReport> {
  const results: GuardrailEvalCaseResult[] = []

  const boundary = stringEvaluationBoundary(guard)
  const ctx = evaluationContext(guard, boundary)

  for (const evalCase of cases) {
    const start = performance.now()

    try {
      const result = validateGuardrailRunResult(await guard.run(evalCase.input as never, ctx as never), {
        streaming: false,
        last: true,
        policyId: guard.id,
        boundary: boundary.id,
      })
      const durationMs = performance.now() - start

      results.push({
        input: evalCase.input,
        passed: result.action === evalCase.expect,
        action: result.action,
        expected: evalCase.expect,
        durationMs,
        ...(result.action === 'rewrite' ? { output: stringifyGuardrailValue(result.value) } : {}),
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

function stringEvaluationBoundary(guard: Guardrail): BoundaryDef {
  const boundaries = Array.isArray(guard.on) ? guard.on : [guard.on]
  if (boundaries.some((boundary) => isMediaSafetyTargetId(boundary.id))) {
    throw new SafetyConfigError({
      message:
        `evaluateGuardrail() accepts string cases and cannot evaluate media policy "${guard.id}". ` +
        'Test media policies through a canonical input or completed-operation integration.',
      boundaries: boundaries.map((boundary) => boundary.id),
      kinds: ['guardrail'],
    })
  }
  return boundaries[0] ?? { _tag: 'Boundary', id: 'model.output.text' }
}

function evaluationContext<B extends BoundaryDef>(guard: Guardrail, boundary: B): SafetyRunContext<B> {
  return {
    policy: { id: guard.id, mode: guard.mode },
    boundary: { id: boundary.id as never, kind: boundary.id as never },
    prompt: { id: undefined },
    model: { id: undefined },
    trace: { id: undefined },
    attempt: { index: 0, kind: 'initial' },
    metadata: {},
    findings: { add() {} },
    ...(selectedPath(boundary) ? { path: selectedPath(boundary) } : {}),
  }
}

function stringifyGuardrailValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}
