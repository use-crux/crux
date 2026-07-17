import type { BoundaryDef, SafetyTargetId } from '../boundary'
import { SafetyConfigError } from '../errors'

/** A boundary supported by the output-oriented constraint lifecycle. */
export type ConstraintBoundary = BoundaryDef<
  Exclude<SafetyTargetId, 'user.input.media'>,
  unknown
>

/** Reject boundaries that have no constraint execution lifecycle. */
export function assertConstraintBoundary(value: {
  readonly id: string
  readonly on: BoundaryDef
}): void {
  if (value.on.id !== 'user.input.media') return

  throw new SafetyConfigError({
    message:
      `Safety constraint "${value.id}" cannot target boundary "user.input.media". ` +
      'Input media is guardrail-only; use guardrail({ on: boundary.input.media(), ... }) instead.',
    boundaries: [value.on.id],
    kinds: ['constraint'],
  })
}
