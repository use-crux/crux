/**
 * Shared constraint/guardrail policy for adapter factories.
 *
 * Owns how the three configuration scopes (per-call, per-prompt, global)
 * combine, how constraint feedback is phrased for the model, and how
 * guardrail audits reach instrumentation — so `adapter()` and
 * `executorAdapter()` enforce identical safety semantics.
 *
 * @module
 */

import { getRuntime } from '../../runtime'
import type { Constraint } from '../../safety/constraint/types'
import type { Guardrail, GuardrailAudit } from '../../safety/guardrail/types'

/**
 * Merge constraints from the three configuration scopes via union strategy.
 *
 * Constraints are deduplicated by `name`; when the same name appears in
 * multiple scopes, the most specific scope wins: per-call over per-prompt
 * over global. This lets a call site soften or replace a globally
 * configured constraint without touching global config.
 */
export function mergeConstraints(
  perCall?: Constraint[],
  perPrompt?: Constraint[],
  global?: Constraint[],
): Constraint[] {
  const seen = new Map<string, Constraint>()
  for (const c of global ?? []) seen.set(c.name, c)
  for (const c of perPrompt ?? []) seen.set(c.name, c)
  for (const c of perCall ?? []) seen.set(c.name, c)
  return [...seen.values()]
}

/**
 * Format combined constraint feedback as the corrective user message
 * injected before a constraint-driven regeneration. Shared so every
 * adapter retries with the exact phrasing constraints were tuned against.
 */
export function formatConstraintFeedback(feedback: string): string {
  return [
    'Your previous output did not satisfy the following quality constraints. Please fix all issues in your next response.',
    '',
    feedback,
  ].join('\n')
}

/**
 * Merge guardrails from the three configuration scopes via union strategy.
 * Same name-keyed precedence as {@link mergeConstraints}: per-call wins
 * over per-prompt wins over global.
 */
export function mergeGuardrails(perCall?: Guardrail[], perPrompt?: Guardrail[], global?: Guardrail[]): Guardrail[] {
  const seen = new Map<string, Guardrail>()
  for (const g of global ?? []) seen.set(g.name, g)
  for (const g of perPrompt ?? []) seen.set(g.name, g)
  for (const g of perCall ?? []) seen.set(g.name, g)
  return [...seen.values()]
}

/**
 * Emit one `onGuardrailRun` instrumentation hook per applied audit entry,
 * wiring guardrail outcomes into devtools/OTel after a pipeline run.
 * No-op when no hook is registered.
 */
export function emitGuardrailHooks(audit: GuardrailAudit, traceId?: string): void {
  const hooks = getRuntime().instrumentationHooks
  if (!hooks?.onGuardrailRun) return
  for (const entry of audit.applied) {
    hooks.onGuardrailRun({
      guardrailId: entry.guard,
      phase: entry.phase,
      action: entry.action as 'pass' | 'block' | 'redact' | 'transform' | 'warn',
      durationMs: entry.durationMs,
      traceId,
    })
  }
}
