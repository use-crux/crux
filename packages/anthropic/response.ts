import type Anthropic from '@anthropic-ai/sdk'
import type { AdapterResponse } from '@crux/core/adapter'
import { anthropicMessageToolRoundCodec } from './message-codec'

/** Anthropic message shape returned by `messages.parse()`. */
export type AnthropicParsedMessage = Anthropic.Message & { readonly parsed_output?: unknown }

/** Extract plain assistant text from Anthropic content blocks. */
export function extractText(message: Pick<Anthropic.Message, 'content'>): string {
  return anthropicMessageToolRoundCodec.readAssistantTurn(message).text
}

/**
 * Normalize an Anthropic response message into Crux's adapter response shape.
 *
 * The message codec owns assistant text/tool-call extraction. This module adds
 * the response-level metadata that does not belong to transcript translation:
 * parsed structured output, token usage, finish reason, ids, and model ids.
 */
export function extractAdapterResponse(result: AnthropicParsedMessage): AdapterResponse {
  const assistant = Array.isArray(result.content)
    ? anthropicMessageToolRoundCodec.readAssistantTurn(result)
    : { text: '', toolCalls: undefined }
  const inputTokens = result.usage?.input_tokens ?? 0
  const outputTokens = result.usage?.output_tokens ?? 0

  return {
    text: result.parsed_output != null ? parsedOutputText(result.parsed_output) : assistant.text,
    toolCalls: assistant.toolCalls,
    usage: {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
    },
    finishReason: result.stop_reason ?? undefined,
    responseId: result.id,
    actualModelId: result.model,
  }
}

function parsedOutputText(parsedOutput: unknown): string {
  return typeof parsedOutput === 'string' ? parsedOutput : JSON.stringify(parsedOutput)
}
