import type { Message } from '../../generation/messages'
import type { GuardrailAudit, GuardrailContext } from '../guardrail/types'
import type { GuardrailBinding } from '../registry'
import type { SafetyProtocolEvent } from '../session'
import { guardInputMedia } from './media'
import { guardProjectedTextInput } from './projected-text'

interface GuardInputOptions {
  readonly bindings: readonly GuardrailBinding[]
  readonly input: {
    readonly messages: readonly Message[]
    readonly prompt?: string
  }
  readonly context: (messages: readonly Message[]) => GuardrailContext
  readonly appendAudit: (audit: GuardrailAudit) => void
  readonly transcript: SafetyProtocolEvent[]
}

/** Run canonical media boundaries before the projected-text input pass. */
export async function guardInput(
  options: GuardInputOptions,
): Promise<{ readonly messages: readonly Message[]; readonly prompt?: string }> {
  const mediaBindings = options.bindings.filter((binding) => binding.boundary.id === 'user.input.media')
  const textBindings = options.bindings.filter((binding) => binding.boundary.id !== 'user.input.media')

  const media = await guardInputMedia({
    bindings: mediaBindings,
    messages: options.input.messages,
    context: options.context,
    appendAudit: options.appendAudit,
  })

  const text = await guardProjectedTextInput({
    bindings: textBindings,
    input: { messages: media.messages, prompt: options.input.prompt },
    context: options.context,
  })
  if (text.audit) options.appendAudit(text.audit)

  if (media.ran || text.ran) {
    options.transcript.push({
      t: 'input.guard',
      guards: mediaBindings.length + textBindings.length,
      actions: [...media.actions, ...text.actions],
    })
  }

  return { messages: text.messages, prompt: text.prompt }
}
