import { createGuardrailPipeline } from '../guardrail/pipeline'
import type { GuardrailAudit, GuardrailContext } from '../guardrail/types'
import type { GuardrailBinding } from '../registry'
import { inputBindingsFor } from './source'

export type OperationInputTextBoundary = 'model.input.text' | 'model.instructions'

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
    const bindings =
      slot.boundary === 'model.input.text'
        ? inputBindingsFor(options.bindings, slot.boundary, 'user')
        : options.bindings.filter((binding) => binding.boundary.id === slot.boundary)
    if (bindings.length === 0) {
      guarded.push(slot)
      continue
    }

    const result = await createGuardrailPipeline(bindings).runInput(slot.value, {
      ...options.context,
      ...(slot.boundary === 'model.input.text'
        ? { origin: { source: 'user' as const, kind: 'operation' as const } }
        : {}),
    })
    options.appendAudit(result.audit)
    guarded.push({ ...slot, value: result.content })
  }

  return guarded
}
