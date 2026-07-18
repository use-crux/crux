import type { BoundaryDef } from './boundary'
import type { GuardrailAuditEntry } from './guardrail/types'
import type { SafetyBinding } from './registry'

/** Audit call-site tuning that disabled an otherwise applicable guardrail. */
export function disabledBindingEntries(bindings: readonly SafetyBinding[]): GuardrailAuditEntry[] {
  const entries: GuardrailAuditEntry[] = []
  for (const binding of bindings) {
    if (binding.kind !== 'guardrail' || binding.enabled || binding.dormantReason !== undefined) continue
    entries.push({
      guard: binding.policy.id,
      ...(binding.policy.category !== undefined ? { category: binding.policy.category } : {}),
      boundary: binding.boundary.id,
      mode: binding.mode,
      phase: boundaryPhase(binding.boundary),
      action: 'allow',
      reason: 'disabled by call site',
      durationMs: 0,
    })
  }
  return entries
}

/** Audit global exact bindings that cannot run for the selected primitive. */
export function dormantBindingEntries(bindings: readonly SafetyBinding[]): GuardrailAuditEntry[] {
  return bindings.flatMap((binding) => {
    if (binding.dormantReason === undefined) return []
    return [
      {
        guard: binding.policy.id,
        ...(binding.policy.category !== undefined ? { category: binding.policy.category } : {}),
        boundary: binding.boundary.id,
        mode: binding.mode,
        phase: boundaryPhase(binding.boundary),
        action: 'dormant',
        reason: binding.dormantReason,
        durationMs: 0,
      },
    ]
  })
}

function boundaryPhase(boundary: BoundaryDef): 'input' | 'output' {
  return boundary.id === 'user.input' || boundary.id === 'user.input.media' || boundary.id === 'model.input'
    ? 'input'
    : 'output'
}
