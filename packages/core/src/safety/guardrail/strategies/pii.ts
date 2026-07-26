/**
 * Provider-agnostic PII strategy helpers for text guardrails.
 *
 * @module
 */

import type { BoundaryDef } from '../../boundary'
import type { GuardrailRun, ClosedGuardrailRunResult, GuardrailRewriteKind } from '../types'
import { hashPatterns, maskPatterns, PII_PATTERNS, rewritePatterns } from './patterns'

type TextBoundary = BoundaryDef<
  'model.input.text' | 'model.instructions' | 'model.output.text' | 'validation.feedback',
  string
>

export interface PiiGuardrailOptions {
  /** Rewrite strategy to apply when PII is found. Defaults to `'redact'`. */
  readonly strategy?: Extract<GuardrailRewriteKind, 'redact' | 'mask' | 'hash'>
}

/** Create a provider-agnostic PII redaction strategy for text boundaries. */
export function pii(options: PiiGuardrailOptions = {}): GuardrailRun<TextBoundary> {
  const strategy = options.strategy ?? 'redact'
  const run = async (subject: string): Promise<ClosedGuardrailRunResult<string>> => {
    const rewrite =
      strategy === 'mask'
        ? maskPatterns(subject, PII_PATTERNS)
        : strategy === 'hash'
          ? hashPatterns(subject, PII_PATTERNS)
          : rewritePatterns(subject, PII_PATTERNS)

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
      kind: 'guardrail.pii',
      config: { strategy },
      // Evaluate whole sentences so a match split across deltas is not missed.
      defaultUnit: 'sentence' as const,
    },
  })
}
