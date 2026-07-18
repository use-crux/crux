import type { BoundaryDef, MediaSafetyTargetId, SafetyTargetId } from '../boundary'
import { isMediaSafetyTargetId } from '../boundary'
import { SafetyConfigError } from '../errors'

/** A boundary supported by the output-oriented constraint lifecycle. */
export type ConstraintBoundary = BoundaryDef<Exclude<SafetyTargetId, MediaSafetyTargetId>, unknown>

/** Reject boundaries that have no constraint execution lifecycle. */
export function assertConstraintBoundary(value: { readonly id: string; readonly on: BoundaryDef }): void {
  if (!isMediaSafetyTargetId(value.on.id)) return

  throw new SafetyConfigError({
    message:
      `Safety constraint "${value.id}" cannot target boundary "${value.on.id}". ` +
      'Media boundaries are guardrail-only; use guardrail({ on: boundary.input.media() or boundary.output.media(), ... }) instead.',
    boundaries: [value.on.id],
    kinds: ['constraint'],
  })
}
