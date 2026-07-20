import type { SafetyBinding } from './registry'

/** @internal Result of classifying one fully validated exact binding. */
export type SafetyBindingApplicability = (
  binding: SafetyBinding,
) => Readonly<{ readonly active: true }> | Readonly<{ readonly active: false; readonly reason: string }>

/** Apply primitive-owned applicability without bypassing registry validation. */
export function applyBindingApplicability(binding: SafetyBinding, classify: SafetyBindingApplicability): SafetyBinding {
  const result = classify(binding)
  return result.active ? binding : { ...binding, dormantReason: result.reason }
}
