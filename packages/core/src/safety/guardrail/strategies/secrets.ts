/**
 * Provider-agnostic secret redaction strategy for text guardrails.
 *
 * @module
 */

import type { BoundaryDef } from '../../boundary'
import type { GuardrailRun, ClosedGuardrailRunResult } from '../types'
import { rewritePatterns, SECRET_PATTERNS } from './patterns'

type TextBoundary = BoundaryDef<
  'model.input.text' | 'model.instructions' | 'model.output.text' | 'validation.feedback',
  string
>

export interface SecretsGuardrailOptions {
  /** Rewrite strategy for matched secrets. Only `'redact'` is supported. */
  readonly strategy?: 'redact'
}

/** Create a provider-agnostic secret redaction strategy for text boundaries. */
export function secrets(options: SecretsGuardrailOptions = {}): GuardrailRun<TextBoundary> {
  const strategy = options.strategy ?? 'redact'
  const run = async (subject: string): Promise<ClosedGuardrailRunResult<string>> => {
    const rewrite = rewritePatterns(subject, SECRET_PATTERNS)
    if (rewrite.findings.length === 0) return { action: 'allow' }
    return {
      action: 'rewrite',
      value: rewrite.value,
      rewrite: { kind: strategy },
      findings: rewrite.findings,
    }
  }

  return Object.assign(run, {
    strategy: {
      kind: 'guardrail.secrets',
      config: { strategy },
      // Evaluate whole sentences so a secret split across deltas is not missed.
      defaultUnit: 'sentence' as const,
    },
  })
}
