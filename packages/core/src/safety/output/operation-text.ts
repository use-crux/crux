import { createGuardrailPipeline } from '../guardrail/pipeline'
import type { GuardrailAudit, GuardrailContext } from '../guardrail/types'
import type { GuardrailBinding } from '../registry'

interface GuardOutputOperationTextOptions {
  readonly bindings: readonly GuardrailBinding[]
  readonly text: string
  readonly context: GuardrailContext
  readonly appendAudit: (audit: GuardrailAudit) => void
}

/** Guard one completed-operation output text authority at its exact boundary. */
export async function guardOutputOperationText(options: GuardOutputOperationTextOptions): Promise<string> {
  const bindings = options.bindings.filter((binding) => binding.boundary.id === 'model.output.text')
  if (bindings.length === 0) return options.text

  const result = await createGuardrailPipeline(bindings).runOutput(options.text, options.context)
  options.appendAudit(result.audit)
  return result.content
}
