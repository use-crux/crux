import type { GuardrailAudit, GuardrailContext } from '../guardrail/types'
import type { GuardrailBinding } from '../registry'
import { createTextReplayEngine } from '../stream/text-replay'

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

  // Complete-source generate feed: adaptive/`.complete()` guards evaluate the whole
  // text once; explicit refinements segment it via the shared replay engine.
  const engine = createTextReplayEngine({
    textBindings: bindings,
    mode: 'generate',
    guardContext: () => options.context,
    appendGuardrailAudit: options.appendAudit,
  })
  await engine.feed(options.text)
  return (await engine.finish()).text
}
