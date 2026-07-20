import type { Message } from '../../generation/messages'
import type { MediaPartSubject } from '../boundary'
import type { GuardrailAudit, GuardrailContext } from '../guardrail/types'
import { visitMedia, type MediaVisitGroup, type MediaVisitItem } from '../media/visit'
import type { GuardrailBinding } from '../registry'

interface GuardInputMediaOptions {
  readonly bindings: readonly GuardrailBinding[]
  readonly messages: readonly Message[]
  readonly context: (messages: readonly Message[]) => GuardrailContext
  readonly appendAudit: (audit: GuardrailAudit) => void
}

export interface MediaInputResult {
  readonly messages: readonly Message[]
  readonly actions: readonly string[]
  readonly ran: boolean
}

/** Visit canonical user media in original order without provider projection. */
export async function guardInputMedia(options: GuardInputMediaOptions): Promise<MediaInputResult> {
  const projection = projectInputMedia(options.messages)
  const stripped = new Set<string>()
  let messages = options.messages
  const result = await visitMedia({
    phase: 'input',
    bindings: options.bindings,
    items: projection.items,
    groups: projection.groups,
    context: () => options.context(messages),
    appendAudit: options.appendAudit,
    onStrip: ({ subject }) => {
      if (subject.origin.kind !== 'message') throw new Error('Input media requires a message origin.')
      stripped.add(coordinateKey(subject.origin.messageIndex, subject.origin.partIndex))
      messages = rebuildStrippedMessage(options.messages, messages, subject.origin.messageIndex, stripped)
    },
  })

  return {
    messages,
    actions: result.actions,
    ran: result.ran,
  }
}

function projectInputMedia(messages: readonly Message[]): {
  readonly items: readonly MediaVisitItem[]
  readonly groups: readonly MediaVisitGroup[]
} {
  const items: MediaVisitItem[] = []
  const groups: MediaVisitGroup[] = []

  for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
    const message = messages[messageIndex]
    if (!message || message.role !== 'user' || typeof message.content === 'string') continue

    const groupId = `message:${messageIndex}`
    let hasMedia = false
    for (let partIndex = 0; partIndex < message.content.length; partIndex++) {
      const part = message.content[partIndex]
      if (!part || part.type === 'text') continue
      hasMedia = true
      const origin = { kind: 'message' as const, messageIndex, partIndex }
      const subject: MediaPartSubject = { part, origin }
      items.push({ subject, groupId })
    }
    if (hasMedia) {
      groups.push({ id: groupId, size: message.content.length, minimumRetained: 1 })
    }
  }

  return { items, groups }
}

function rebuildStrippedMessage(
  originalMessages: readonly Message[],
  currentMessages: readonly Message[],
  messageIndex: number,
  stripped: ReadonlySet<string>,
): readonly Message[] {
  const original = originalMessages[messageIndex]
  if (!original || original.role !== 'user' || typeof original.content === 'string') return currentMessages

  const content = original.content.filter((_part, partIndex) => !stripped.has(coordinateKey(messageIndex, partIndex)))
  return currentMessages.map((message, index) => (index === messageIndex ? { ...original, content } : message))
}

function coordinateKey(messageIndex: number, partIndex: number): string {
  return `${messageIndex}:${partIndex}`
}
