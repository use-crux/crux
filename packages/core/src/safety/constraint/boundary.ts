import type { BoundaryDef } from '../boundary'
import { SafetyConfigError } from '../errors'

type ConstraintTargetId =
  | 'model.output.text'
  | 'model.output.object'
  | 'model.output'

/** A boundary supported by the output-oriented constraint lifecycle. */
export type ConstraintBoundary = BoundaryDef<ConstraintTargetId, unknown>

/** Reject boundaries that have no constraint execution lifecycle. */
export function assertConstraintBoundary(value: { readonly id: string; readonly on: BoundaryDef }): void {
  if (
    value.on.id === 'model.output.text' ||
    value.on.id === 'model.output.object' ||
    value.on.id === 'model.output'
  ) {
    return
  }

  throw new SafetyConfigError({
    message:
      `Safety constraint "${value.id}" cannot target boundary "${value.on.id}". ` +
      'Constraints can target only model.output.text, model.output.object, or model.output; use a guardrail for protective input, media, tool, or memory policies.',
    boundaries: [value.on.id],
    kinds: ['constraint'],
  })
}
