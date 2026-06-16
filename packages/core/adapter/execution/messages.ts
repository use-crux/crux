/**
 * Message helpers for adapter execution.
 *
 * The two adapter dialects start conversations differently: core-step adapters
 * always need a concrete message list, while SDK-loop executors may pass a
 * prompt string until history exists. These helpers keep that shaping explicit.
 *
 * @internal
 * @module
 */

import type { Message } from '../../messages'
import type { AdapterResponse } from '../types'

/**
 * Append the final assistant response to a provider-agnostic Crux transcript.
 *
 * Approval suspension skips this helper because the approval-request message
 * is already sealed by `ToolLifecycle.suspend()`.
 */
export function appendAssistantResultMessage(messages: Message[], response: AdapterResponse | undefined): Message[] {
  if (!response) return messages
  return [
    ...messages,
    {
      role: 'assistant' as const,
      content: response.text,
      ...(response.toolCalls ? { metadata: { toolCalls: response.toolCalls } } : {}),
    },
  ]
}

/**
 * Build initial SDK-loop message state.
 *
 * If the caller did not provide history, a plain resolved prompt is preserved
 * as `promptText` so SDKs that accept prompt strings can use their native path.
 */
export function initialMessageState(
  resolved: { readonly prompt?: string; readonly messages?: readonly unknown[] },
  messages?: Message[],
): { messages: Message[]; promptText: string | undefined } {
  const history: Message[] = [...(messages ?? [])]
  let promptText: string | undefined
  if (history.length === 0 && resolved.prompt) {
    promptText = resolved.prompt
  } else if (history.length === 0 && resolved.messages) {
    history.push(...(resolved.messages as Message[]))
  }
  return { messages: history, promptText }
}

/**
 * Build initial core-step messages.
 *
 * Core-step providers always receive messages, so a resolved prompt string is
 * converted into a first user message when no history exists.
 */
export function initialCoreMessages(
  resolved: { readonly prompt?: string; readonly messages?: readonly unknown[] },
  messages?: Message[],
): Message[] {
  const history: Message[] = [...(messages ?? [])]
  if (history.length === 0 && resolved.prompt) {
    history.push({ role: 'user', content: resolved.prompt })
  } else if (history.length === 0 && resolved.messages) {
    history.push(...(resolved.messages as Message[]))
  }
  return history
}

/**
 * Append a failed assistant output plus validation feedback as a user turn.
 *
 * Used by structured retry so the model sees both the invalid output and the
 * corrective instruction in the next attempt.
 */
export function appendCorrectiveExchange(
  promptText: string | undefined,
  messages: readonly Message[],
  failedOutput: string,
  feedback: string,
): Message[] {
  return appendCorrectiveMessages(promptText, messages, failedOutput, [{ role: 'user', content: feedback }])
}

/**
 * Append arbitrary corrective messages after a failed assistant output.
 *
 * If the conversation was still represented as a prompt string, the prompt is
 * first materialized as a user message to create a valid transcript.
 */
export function appendCorrectiveMessages(
  promptText: string | undefined,
  messages: readonly Message[],
  failedOutput: string,
  corrective: readonly Message[],
): Message[] {
  const base: Message[] =
    messages.length > 0 ? [...messages] : promptText ? [{ role: 'user', content: promptText }] : []
  return [...base, { role: 'assistant', content: failedOutput || 'Invalid output' }, ...corrective]
}
