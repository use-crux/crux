/**
 * Default native chat tool-round transcript append.
 *
 * Providers with canonical assistant/tool message semantics can reuse this;
 * providers with richer transcript needs can override `appendToolRound` in
 * their `NativeChatProfile`.
 *
 * @module
 */

import type { Message } from '../../messages'
import type { AdapterResponse, ToolResultEntry } from '../types'

/**
 * Append an assistant tool-call turn and its tool results using canonical
 * Crux message metadata.
 *
 * @param messages - Existing canonical transcript.
 * @param assistant - Normalized assistant response containing tool calls.
 * @param results - Tool execution results to feed into the next provider call.
 * @returns A new canonical transcript including the tool round.
 */
export function appendNativeToolRound(
  messages: readonly Message[],
  assistant: AdapterResponse,
  results: readonly ToolResultEntry[],
): Message[] {
  return [
    ...messages,
    {
      role: 'assistant',
      content: assistant.text,
      metadata: { toolCalls: assistant.toolCalls },
    },
    ...results.map(
      (result): Message => ({
        role: 'tool',
        content: result.content,
        metadata: {
          toolCallId: result.toolCallId,
          toolName: result.name,
          modelOutput: result.modelOutput,
          ...(result.isError !== undefined ? { isError: result.isError } : {}),
          ...(result.modelOutputError !== undefined ? { modelOutputError: result.modelOutputError } : {}),
        },
      }),
    ),
  ]
}
