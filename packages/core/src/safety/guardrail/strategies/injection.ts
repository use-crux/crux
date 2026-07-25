/**
 * Prompt-injection heuristic strategy for text guardrails.
 *
 * @module
 */

import type { BoundaryDef } from '../../boundary'
import { detectSuspiciousPatterns, escapeXml } from '../../../shared/sanitize'
import type { GuardrailRun, ClosedGuardrailRunResult } from '../types'

type TextBoundary = BoundaryDef<
  'model.input.text' | 'model.instructions' | 'model.output.text' | 'validation.feedback',
  string
>

export interface InjectionGuardrailOptions {
  /** Action to take when suspicious prompt-injection text is detected. */
  readonly action?: 'block' | 'warn' | 'rewrite'
}

/** Create a heuristic prompt-injection strategy for text boundaries. */
export function injection(options: InjectionGuardrailOptions = {}): GuardrailRun<TextBoundary> {
  const action = options.action ?? 'block'
  const run = async (subject: string): Promise<ClosedGuardrailRunResult<string>> => {
    const warnings = detectSuspiciousPatterns(subject, 'subject')
    if (warnings.length === 0) return { action: 'allow' }

    const findings = warnings.map((warning) => ({ type: warning.pattern, count: 1 }))
    const reason = `Suspicious prompt-injection pattern detected: ${warnings.map((warning) => warning.pattern).join(', ')}.`

    if (action === 'warn') return { action: 'warn', reason }
    if (action === 'rewrite') {
      return {
        action: 'rewrite',
        value: escapeXml(subject),
        rewrite: { kind: 'normalize' },
        findings,
      }
    }
    return { action: 'block', reason }
  }

  return Object.assign(run, {
    strategy: {
      kind: 'guardrail.injection',
      config: { action },
      // Evaluate whole sentences so an injection split across deltas is not missed.
      defaultUnit: 'sentence' as const,
    },
  })
}
