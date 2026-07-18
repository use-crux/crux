import { createGuardrailPipeline } from '../guardrail/pipeline'
import type { GuardrailAudit, GuardrailContext } from '../guardrail/types'
import type { GuardrailBinding } from '../registry'

export type OperationInputTextBoundary = 'user.input' | 'model.input'

/** One canonical completed-operation input text slot. */
export interface OperationInputTextSlot {
  readonly boundary: OperationInputTextBoundary
  readonly value: string
}

interface GuardInputOperationTextOptions {
  readonly bindings: readonly GuardrailBinding[]
  readonly slots: readonly OperationInputTextSlot[]
  readonly context: GuardrailContext
  readonly appendAudit: (audit: GuardrailAudit) => void
}

/** Guard completed-operation text slots by their exact canonical boundary. */
export async function guardInputOperationText(
  options: GuardInputOperationTextOptions,
): Promise<readonly OperationInputTextSlot[]> {
  const guarded: OperationInputTextSlot[] = []

  for (const slot of options.slots) {
    const bindings = options.bindings.filter((binding) => binding.boundary.id === slot.boundary)
    if (bindings.length === 0) {
      guarded.push(slot)
      continue
    }

    const result = await createGuardrailPipeline(bindings).runInput(slot.value, options.context)
    options.appendAudit(result.audit)
    guarded.push({ ...slot, value: result.content })
  }

  return guarded
}
