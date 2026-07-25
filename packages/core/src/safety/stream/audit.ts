import type { GuardrailAudit, GuardrailAuditEntry, GuardrailRunResult } from '../guardrail/types'
import type { GuardrailBinding } from '../registry'

type AppendGuardrailAudit = (audit: GuardrailAudit) => void

/** Record a stream segment action that changed, warned on, or blocked output. */
export function recordStreamChunkAction(
  appendGuardrailAudit: AppendGuardrailAudit,
  binding: GuardrailBinding,
  result: GuardrailRunResult<unknown>,
  reason?: string,
  options?: { readonly blocked?: boolean },
): void {
  if (result.action === 'allow' || result.action === 'hold') return

  const guard = binding.policy
  const entry: GuardrailAuditEntry = {
    guard: guard.id,
    ...(guard.category !== undefined ? { category: guard.category } : {}),
    boundary: binding.boundary.id,
    mode: binding.mode,
    phase: 'output',
    action: auditAction(result),
    ...(reason ? { reason } : {}),
    durationMs: 0,
  }
  appendGuardrailAudit({ applied: [entry], blocked: options?.blocked ?? result.action === 'block' })
}

function auditAction(result: GuardrailRunResult<unknown>): string {
  if (result.action === 'rewrite') return result.rewrite.kind === 'normalize' ? 'transform' : result.rewrite.kind
  return result.action
}
