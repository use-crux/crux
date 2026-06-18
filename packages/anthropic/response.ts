import type Anthropic from '@anthropic-ai/sdk'
import type { AdapterResponse } from '@crux/core/adapter'
import type { NativeAssistantTurn, NativeResponseMetadata } from '@crux/core/adapter'
import { anthropicTranscript } from './message-codec'

/** Anthropic message shape returned by `messages.parse()`. */
export type AnthropicParsedMessage = Anthropic.Message & { readonly parsed_output?: unknown }

/** Extract plain assistant text from Anthropic content blocks. */
export function extractText(message: Pick<Anthropic.Message, 'content'>): string {
  return anthropicTranscript.readAssistant(message).text
}

/**
 * Normalize an Anthropic response message into Crux's adapter response shape.
 *
 * The message codec owns assistant text/tool-call extraction. This module adds
 * the response-level metadata that does not belong to transcript translation:
 * parsed structured output, token usage, finish reason, ids, and model ids.
 */
export function extractAdapterResponse(result: AnthropicParsedMessage): AdapterResponse {
  const assistant = anthropicTranscript.readAssistant(result)

  return {
    ...anthropicResponseMeta(result),
    text: anthropicResponseText(result, assistant),
    toolCalls: assistant.toolCalls,
  }
}

/** Read response metadata that is not owned by Anthropic transcript conversion. */
export function anthropicResponseMeta(result: AnthropicParsedMessage): NativeResponseMetadata {
  const inputTokens = result.usage?.input_tokens ?? 0
  const outputTokens = result.usage?.output_tokens ?? 0

  return {
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

/** Prefer Anthropic parsed structured output over transcript text when present. */
export function anthropicResponseText(result: AnthropicParsedMessage, assistant: NativeAssistantTurn): string {
  return result.parsed_output != null ? parsedOutputText(result.parsed_output) : assistant.text
}

function parsedOutputText(parsedOutput: unknown): string {
  return typeof parsedOutput === 'string' ? parsedOutput : JSON.stringify(parsedOutput)
}
