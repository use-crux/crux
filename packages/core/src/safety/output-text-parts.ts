import type { SafetyProtocolEvent } from './session'
import { createGuardrailPipeline } from './guardrail/pipeline'
import type { Guardrail, GuardrailAudit, GuardrailContext } from './guardrail/types'

/**
 * Run output-text guardrails independently for provider completion slots.
 *
 * @internal
 */
export async function guardOutputTextParts(
  options: Readonly<{
    guards: readonly Guardrail[]
    parts: readonly string[]
    context: GuardrailContext
    appendAudit: (audit: GuardrailAudit) => void
    transcript: SafetyProtocolEvent[]
  }>,
): Promise<readonly string[]> {
  const guards = options.guards.filter(guardsTextOutput)
  if (guards.length === 0) return [...options.parts]

  const pipeline = createGuardrailPipeline(guards)
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
    guards: guards.length,
    actions,
  })
  return guarded
}

function guardsTextOutput(guard: Guardrail): boolean {
  const boundaries = Array.isArray(guard.on) ? guard.on : [guard.on]
  return boundaries.some((boundary) => boundary.id === 'model.output.text' || boundary.id === 'model.output')
}
