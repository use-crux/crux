/**
 * Shared resolved-prompt plumbing for adapter factories.
 *
 * Small policies that read or react to a `ResolvedPrompt` identically in
 * both `adapter()` and `executorAdapter()`: skill-activation session access
 * and post-generation memory capture.
 *
 * @module
 */

import type { ResolvedPrompt } from '../../types'
import type { Message } from '../../messages'
import type { SkillActivationSession } from '../../skill/session'

/**
 * Read the explicit skill activation session set by prompt resolution.
 */
export function readSkillActivationSession(resolved: ResolvedPrompt): SkillActivationSession | undefined {
  const candidate = resolved as ResolvedPrompt & { _skillSession?: SkillActivationSession }
  return candidate._skillSession
}

/**
 * Capture a completed generation turn into every memory bound to the
 * resolved prompt, then flush.
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
    toolCalls?: Array<{ id?: string; name: string; args: unknown }>
  },
): Promise<void> {
  if (!resolved.memoryBindings || resolved.memoryBindings.length === 0) return

  const userMessages = args.messages
    .filter((message) => message.role === 'user' && typeof message.content === 'string')
    .map((message) => ({ role: 'user', content: message.content as string }))
  const assistantMessages = args.assistantText !== undefined ? [{ role: 'assistant', content: args.assistantText }] : []

  await Promise.all(
    resolved.memoryBindings.map(async (binding) => {
      await binding.memory.captureTurn(
        {
          messages: [...userMessages, ...assistantMessages],
          toolEvents: args.toolCalls?.map((toolCall) => ({
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            args: toolCall.args,
          })),
          source: { promptId: binding.promptId ?? args.promptId },
        },
        {
          input: binding.input ?? args.input,
          promptId: binding.promptId ?? args.promptId,
        },
      )
      await binding.memory.flush({
        input: binding.input ?? args.input,
        promptId: binding.promptId ?? args.promptId,
      })
    }),
  )
}
