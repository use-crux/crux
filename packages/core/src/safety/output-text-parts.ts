import type { SafetyProtocolEvent } from './session'
import { createGuardrailPipeline } from './guardrail/pipeline'
import type { GuardrailAudit, GuardrailContext } from './guardrail/types'
import type { GuardrailBinding } from './registry'

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

  const pipeline = createGuardrailPipeline(bindings)
  const guarded: string[] = []
  const actions: string[] = []
  for (const part of options.parts) {
    const result = await pipeline.runOutput(part, options.context)
    options.appendAudit(result.audit)
    actions.push(...result.audit.applied.map((entry) => entry.action))
    guarded.push(result.content)
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
