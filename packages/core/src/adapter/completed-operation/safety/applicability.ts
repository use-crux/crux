import { SafetyConfigError } from '../../../safety/errors'
import type { SafetyBindingApplicability } from '../../../safety/applicability'
import type { SafetyCompletedOperation } from './operation'

const applicableBoundaries = {
  generateImage: new Set(['model.input.text', 'model.instructions', 'model.input.media', 'model.output.media']),
  generateSpeech: new Set(['model.input.text', 'model.instructions', 'model.output.media']),
  transcribe: new Set(['model.input.text', 'model.input.media', 'model.output.text']),
} satisfies Record<SafetyCompletedOperation, ReadonlySet<string>>

/** Classify exact bindings for one closed completed-operation primitive. */
export function completedOperationBindingApplicability(
  operation: SafetyCompletedOperation,
): SafetyBindingApplicability {
  return (binding) => {
    if (applicableBoundaries[operation].has(binding.boundary.id)) return { active: true }

    if (binding.scope === 'global') {
      return {
        active: false,
        reason: `Global policy is dormant for ${operation} at ${binding.boundary.id}.`,
      }
    }
    throw new SafetyConfigError({
      message:
        `Safety ${binding.kind} "${binding.policy.id}" cannot target "${binding.boundary.id}" for ${operation}. ` +
        'Remove the binding or attach it to a boundary supported by this operation.',
      boundaries: [binding.boundary.id],
      kinds: [binding.kind],
      scopes: [binding.scope],
    })
  }
}
