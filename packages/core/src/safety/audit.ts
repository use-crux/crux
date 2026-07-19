import type { ConstraintAudit } from './constraint/types'
import type { GuardrailAudit, GuardrailAuditEntry } from './guardrail/types'

/** Applied canonical Safety decisions for one public operation. */
export interface SafetyAudit {
  /** Guardrail actions in stable evaluation order, including report-mode intent. */
  readonly guardrails?: GuardrailAudit
  /** Constraint checks and their aggregate pass/fallback state. */
  readonly constraints?: ConstraintAudit
}

/** Return whether an audit contains at least one canonical Safety entry. */
export function hasSafetyAudit(audit: SafetyAudit): boolean {
  return (
    (audit.guardrails?.applied.length ?? 0) > 0 ||
    audit.guardrails?.blocked === true ||
    (audit.constraints?.entries.length ?? 0) > 0
  )
}

/** Freeze detached audit arrays before attaching them to a public result. */
export function freezeSafetyAudit(audit: SafetyAudit): SafetyAudit {
  return Object.freeze({
    ...(audit.guardrails
      ? {
          guardrails: Object.freeze({
            ...audit.guardrails,
            applied: Object.freeze([...audit.guardrails.applied]),
          }),
        }
      : {}),
    ...(audit.constraints
      ? {
          constraints: Object.freeze({
            ...audit.constraints,
            entries: Object.freeze([...audit.constraints.entries]),
          }),
        }
      : {}),
  })
}

/** Return whether an audit action represents an enforced text rewrite. @internal */
export function isRewriteAuditAction(action: string): boolean {
  return action === 'redact' || action === 'mask' || action === 'hash' || action === 'transform'
}

/** Find the policy responsible for the latest enforced text rewrite. @internal */
export function latestRewritePolicyId(entries: readonly GuardrailAuditEntry[]): string | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (entry?.mode === 'enforce' && isRewriteAuditAction(entry.action)) return entry.guard
  }
  return undefined
}
