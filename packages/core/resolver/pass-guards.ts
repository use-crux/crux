/**
 * Safety checks for prompt/message text produced during resolution.
 *
 * These guards catch accidental object interpolation after user prompt
 * callbacks run, complementing the earlier input proxy guard that catches
 * direct coercion at the source field.
 *
 * @module
 */

import type { AnyMessage } from '../types'
import { contentText } from '../content'
import { isMessageContent } from '../content/guards'

/** Throw when a messages callback emitted the classic object-coercion marker. */
export function assertNoObjectMessageContent(messages: readonly AnyMessage[]): void {
  for (const message of messages) {
    const content = isMessageContent(message.content) ? contentText(message.content) : ''
    if (content.includes('[object Object]')) {
      throw new Error(
        `Message content contains "[object Object]" - an object was interpolated into a ` +
          `string instead of being serialized. Check your messages function for unserialised objects.`,
      )
    }
  }
}

/** Throw when prompt text contains the classic object-coercion marker. */
export function assertNoObjectPromptText(promptText: string | undefined, promptId: string | undefined): void {
  if (!promptText?.includes('[object Object]')) return
  const idx = promptText.indexOf('[object Object]')
  const snippet = promptText.slice(Math.max(0, idx - 80), idx + 80)
  throw new Error(
    `Prompt text contains "[object Object]" - an object was interpolated into a string ` +
      `instead of being serialized.` +
      (promptId ? ` Prompt: "${promptId}".` : '') +
      ` Context: "...${snippet}..."`,
  )
}
