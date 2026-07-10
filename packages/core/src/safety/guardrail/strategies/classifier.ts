/**
 * Provider-agnostic classifier strategy for text guardrails.
 *
 * @module
 */

import type { BoundaryDef } from '../../boundary'
import type { SafetyFinding } from '../../decision'
import type { SafetyRunContext } from '../../decision'
import type { GuardrailRun, GuardrailRunResult } from '../types'

type TextBoundary = BoundaryDef<'user.input' | 'model.input' | 'model.output.text' | 'validation.feedback', string>

export interface ClassifierGuardrailOptions<TResult> {
  /** User-supplied classifier. Provider-specific clients stay outside core. */
  readonly classifier: (subject: string) => TResult | Promise<TResult>
  /** Return true when the classifier result should block the content. */
  readonly blockWhen: (result: TResult) => boolean
  /** Optional finding mapper for audit/devtools metadata. */
  readonly findings?: (result: TResult) => readonly SafetyFinding[]
  /** Static or result-derived block reason. */
  readonly reason?: string | ((result: TResult) => string)
}

/** Create a provider-agnostic classifier strategy for text boundaries. */
export function classifier<TResult>(options: ClassifierGuardrailOptions<TResult>): GuardrailRun<TextBoundary> {
  const run = async (subject: string, ctx: SafetyRunContext<TextBoundary>): Promise<GuardrailRunResult<string>> => {
    const result = await options.classifier(subject)
    if (!options.blockWhen(result)) return { action: 'allow' }
    for (const finding of options.findings?.(result) ?? []) {
      ctx.findings.add(finding)
    }
    return {
      action: 'block',
      reason: typeof options.reason === 'function'
        ? options.reason(result)
        : options.reason ?? 'Classifier blocked the content.',
    }
  }

  return Object.assign(run, {
    strategy: {
      kind: 'guardrail.classifier',
      config: { stream: 'final' },
    },
  })
}
