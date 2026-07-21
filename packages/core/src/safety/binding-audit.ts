import type { BoundaryDef } from './boundary'
import { observe } from '../observability'
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

/** Record safe timeline evidence for bindings intentionally not evaluated. */
export function recordBindingAuditEntries(entries: readonly GuardrailAuditEntry[]): void {
  const spanId = observe.captureContext()?.currentSpanId
  if (!spanId) return

  for (const entry of entries) {
    const details = {
      guardrailName: entry.guard,
      boundary: entry.boundary,
      mode: entry.mode,
      phase: entry.phase,
      action: entry.action,
      ...(entry.reason ? { reason: entry.reason } : {}),
    }
    const artifactId = observe.artifact({
      kind: 'guardrail.report',
      contentType: 'application/json',
      encoding: 'json',
      preview: { kind: 'guardrail.report', ...details },
      attributes: details,
    })
    if (artifactId) {
      observe.edge({
        edgeType: 'produced',
        from: { kind: 'span', id: spanId },
        to: { kind: 'artifact', id: artifactId },
        attributes: details,
      })
    }
    observe.event({ name: 'guardrail.action', attributes: details })
  }
}

function boundaryPhase(boundary: BoundaryDef): 'input' | 'output' {
  return boundary.id === 'model.input.text' ||
    boundary.id === 'model.input.media' ||
    boundary.id === 'model.instructions'
    ? 'input'
    : 'output'
}
