import type { SafetyProtocolEvent } from './session'
import type { GuardrailAudit, GuardrailContext } from './guardrail/types'
import type { GuardrailBinding } from './registry'
import { createTextReplayEngine } from './stream/text-replay'

/**
 * Run output-text guardrails independently for provider completion slots.
 *
 * @internal
 */
export async function guardOutputTextParts(
  options: Readonly<{
    bindings: readonly GuardrailBinding[]
    parts: readonly string[]
    context: GuardrailContext
    appendAudit: (audit: GuardrailAudit) => void
    transcript: SafetyProtocolEvent[]
  }>,
): Promise<readonly string[]> {
  const bindings = options.bindings.filter(bindingGuardsTextOutput)
  if (bindings.length === 0) return [...options.parts]

  const guarded: string[] = []
  const actions: string[] = []
  for (const part of options.parts) {
    // Complete-source generate feed through the shared replay engine.
    const engine = createTextReplayEngine({
      textBindings: bindings,
      mode: 'generate',
      guardContext: () => options.context,
      appendGuardrailAudit: (audit) => {
        options.appendAudit(audit)
        actions.push(...audit.applied.map((entry) => entry.action))
      },
    })
    await engine.feed(part)
    guarded.push((await engine.finish()).text)
  }
  options.transcript.push({
    t: 'output.guard',
    guards: bindings.length,
    actions,
  })
  return guarded
}

function bindingGuardsTextOutput(binding: GuardrailBinding): boolean {
  return binding.boundary.id === 'model.output.text' || binding.boundary.id === 'model.output'
}
