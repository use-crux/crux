/**
 * Tool-call provenance helpers for post-generation memory capture.
 *
 * Adapter responses know the model-requested tool call id/name/args, while
 * the lifecycle session separately knows settled outputs. These helpers keep
 * that merge policy in one place so memory capture can preserve useful audit
 * data without coupling memory blocks to tool-session internals.
 *
 * @module
 */

import type { Message } from '../../generation/messages'
import type { ToolResultEntry } from '../types'

/**
 * Tool call shape forwarded to memory capture.
 *
 * `result` is the raw tool output when the core lifecycle executed the tool.
 * SDK-driven adapters may only expose provider transcript content; in that
 * case the tool message content is used as the best available result.
 */
export interface MemoryCaptureToolCall {
  readonly id?: string
  readonly name: string
  readonly args: unknown
  readonly result?: unknown
  readonly error?: string
}

/**
 * Merge adapter-level tool calls with settled tool outputs from the lifecycle.
 */
export function enrichToolCallsWithResults(
  toolCalls: readonly MemoryCaptureToolCall[] | undefined,
  results: readonly ToolResultEntry[],
): MemoryCaptureToolCall[] | undefined {
  if (!toolCalls) return undefined
  if (results.length === 0) return toolCalls.map((toolCall) => ({ ...toolCall }))

  const byId = new Map(results.map((result) => [result.toolCallId, result]))
  return toolCalls.map((toolCall) => {
    const result = toolCall.id ? byId.get(toolCall.id) : undefined
    if (!result) return { ...toolCall }

    if (result.isError) {
      return { ...toolCall, error: result.modelOutputError ?? result.content }
    }

    return {
      ...toolCall,
      result: result.output ?? result.content,
    }
  })
}

/**
 * Read settled tool-message content from a transcript when the provider SDK
 * executed the loop and the lifecycle did not observe raw tool outputs.
 */
export function enrichToolCallsFromMessages(
  toolCalls: readonly MemoryCaptureToolCall[] | undefined,
  messages: readonly Message[],
): MemoryCaptureToolCall[] | undefined {
  if (!toolCalls) return undefined

  const toolMessages = new Map<string, Message>()
  for (const message of messages) {
    if (message.role !== 'tool') continue
    const toolCallId = message.metadata?.toolCallId
    if (typeof toolCallId === 'string') {
      toolMessages.set(toolCallId, message)
    }
  }

  if (toolMessages.size === 0) return toolCalls.map((toolCall) => ({ ...toolCall }))

  return toolCalls.map((toolCall) => {
    const message = toolCall.id ? toolMessages.get(toolCall.id) : undefined
    if (!message) return { ...toolCall }
    return {
      ...toolCall,
      result: message.content,
    }
  })
}
