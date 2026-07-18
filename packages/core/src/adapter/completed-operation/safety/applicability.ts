import type { BoundaryDef } from '../../../safety/boundary'
import type { Constraint } from '../../../safety/constraint/types'
import { SafetyConfigError } from '../../../safety/errors'

/** Reject call-scoped constraint boundaries unavailable to a completed operation. */
export function assertCompletedOperationConstraintApplicability(
  operation: string,
  constraints: readonly Constraint[] | undefined,
): void {
  if (operation !== 'transcribe' || constraints === undefined) return

  for (const policy of constraints) {
    const boundaries = constraintBoundaries(policy)
    const invalid = boundaries.filter((boundary) => boundary.id !== 'model.output.text')
    if (invalid.length === 0) continue

    throw new SafetyConfigError({
      message:
        `Safety constraint "${policy.id}" cannot target ${invalid.map((boundary) => `"${boundary.id}"`).join(', ')} ` +
        'for transcribe. Attach transcription constraints to boundary.output.text().',
      boundaries: invalid.map((boundary) => boundary.id),
      kinds: ['constraint'],
      scopes: ['call'],
    })
  }
}

function constraintBoundaries(policy: Constraint): readonly BoundaryDef[] {
  return Array.isArray(policy.on) ? policy.on : [policy.on]
}
