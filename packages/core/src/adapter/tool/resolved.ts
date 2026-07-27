/**
 * Shared resolved-prompt plumbing for adapter factories.
 *
 * Small policies that read or react to a `ResolvedPrompt` identically in
 * both `adapter()` and `loopRuntimeAdapter()`: skill-activation session access
 * and post-generation memory capture.
 *
 * @module
 */

import type { ResolvedPrompt } from '../../resolver/types'
import type { Message } from '../../generation/messages'
import type { SkillActivationSession } from '../../skill/session'
import type { MemoryCaptureToolCall } from './memory-capture'
import { messageText } from '../../content'
import {
  attachManagedMemoryWriteGuard,
  type ManagedMemoryWriteGuard,
} from '../../memory/managed-write-guard'

/**
 * Read the explicit skill activation session set by prompt resolution.
 */
export function readSkillActivationSession(resolved: ResolvedPrompt): SkillActivationSession | undefined {
  const candidate = resolved as ResolvedPrompt & {
    _skillSession?: SkillActivationSession
  }
  return candidate._skillSession
}

/**
 * Forward one completed generation turn to every memory bound to the resolved
 * prompt. Each memory owns scheduling, ordered tool-event fan-out, and flush
 * settlement for that turn.
 *
 * No-op when the prompt has no memory bindings. User messages are read
 * from the canonical history; the assistant turn comes from the final
 * generated text. Tool calls are forwarded as memory tool events so
 * episodic memories can reconstruct what the assistant did, not just what
 * it said.
 */
export async function captureMemoryTurn(
  resolved: ResolvedPrompt,
  args: {
    promptId?: string
    input: Record<string, unknown>
    messages: readonly Message[]
    assistantText?: string
    toolCalls?: readonly MemoryCaptureToolCall[]
    /** @internal Per-call Safety capability for managed memory commits. */
    memoryWriteGuard?: ManagedMemoryWriteGuard
  },
): Promise<void> {
  if (!resolved.memoryBindings || resolved.memoryBindings.length === 0) return

  const userMessages = args.messages
    .filter((message) => message.role === 'user')
    .map((message) => ({ role: 'user', content: messageText(message) }))
  const assistantMessages = args.assistantText !== undefined ? [{ role: 'assistant', content: args.assistantText }] : []
  const toolEvents = args.toolCalls?.map((toolCall) => ({
    ...(toolCall.id ? { toolCallId: toolCall.id } : {}),
    toolName: toolCall.name,
    args: toolCall.args,
    ...(toolCall.result !== undefined ? { result: toolCall.result } : {}),
    ...(toolCall.error !== undefined ? { error: toolCall.error } : {}),
  }))

  await Promise.all(
    resolved.memoryBindings.map(async (binding) => {
      const options = attachManagedMemoryWriteGuard({
        input: binding.input ?? args.input,
        promptId: binding.promptId ?? args.promptId,
      }, args.memoryWriteGuard)
      await binding.memory.captureTurn(
        {
          messages: [...userMessages, ...assistantMessages],
          toolEvents,
          source: { promptId: binding.promptId ?? args.promptId },
        },
        options,
      )

    }),
  )
}
