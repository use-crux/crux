import type { SafetyTargetId } from '../boundary'
import type { InputSource } from '../input-origin'
import type { GuardrailBinding } from '../registry'

/** Select exact model-ingress bindings that accept one semantic source. */
export function inputBindingsFor(
  bindings: readonly GuardrailBinding[],
  boundary: SafetyTargetId,
  source: InputSource,
): readonly GuardrailBinding[] {
  return bindings.filter(
    (binding) =>
      binding.boundary.id === boundary &&
      (binding.boundary.from === undefined || binding.boundary.from.includes(source)),
  )
}
