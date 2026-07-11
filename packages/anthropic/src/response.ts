import type Anthropic from "@anthropic-ai/sdk";
import type { AdapterResponse } from "@use-crux/core/adapter";
import type {
  NativeAssistantTurn,
  NativeResponseMetadata,
} from "@use-crux/core/adapter";
import { anthropicTranscript } from "./message-codec";

/** Anthropic message shape returned by `messages.parse()`. */
export type AnthropicParsedMessage = Anthropic.Message & {
  readonly parsed_output?: unknown;
};

/** Extract plain assistant text from Anthropic content blocks. */
export function extractText(
  message: Pick<Anthropic.Message, "content">,
): string {
  return anthropicTranscript.readAssistant(message).text;
}

/**
 * Normalize an Anthropic response message into Crux's adapter response shape.
 *
 * The message codec owns assistant text/tool-call extraction. This module adds
 * the response-level metadata that does not belong to transcript translation:
 * parsed structured output, token usage, finish reason, ids, and model ids.
 */
export function extractAdapterResponse(
  result: AnthropicParsedMessage,
): AdapterResponse {
  const assistant = anthropicTranscript.readAssistant(result);
  const text = anthropicResponseText(result, assistant);
  const content =
    text !== assistant.text
      ? [{ type: "text" as const, text }]
      : typeof assistant.content === "string"
        ? [{ type: "text" as const, text: assistant.content }]
        : assistant.content;

  return {
    ...anthropicResponseMeta(result),
    text,
    ...(content !== undefined ? { content } : {}),
    toolCalls: assistant.toolCalls,
  };
}

/** Read response metadata that is not owned by Anthropic transcript conversion. */
export function anthropicResponseMeta(
  result: AnthropicParsedMessage,
): NativeResponseMetadata {
  const usage = result.usage;
  const inputTokens = usage?.input_tokens;
  const outputTokens = usage?.output_tokens;

  return {
    usage:
      inputTokens !== undefined && outputTokens !== undefined
        ? {
            inputTokens,
            outputTokens,
            totalTokens: inputTokens + outputTokens,
            inputTokenDetails: {
              ...optionalTokenDetail(
                "cacheReadTokens",
                nullableNumber(usage.cache_read_input_tokens),
              ),
              ...optionalTokenDetail(
                "cacheWriteTokens",
                nullableNumber(usage.cache_creation_input_tokens),
              ),
            },
            outputTokenDetails: {
              ...optionalTokenDetail(
                "reasoningTokens",
                nullableNumber(usage.output_tokens_details?.thinking_tokens),
              ),
            },
          }
        : undefined,
    finishReason: result.stop_reason ?? undefined,
    responseId: result.id,
    actualModelId: result.model,
  };
}

function nullableNumber(value: number | null | undefined): number | undefined {
  return value === null ? undefined : value;
}

function optionalTokenDetail<K extends string>(
  key: K,
  value: number | undefined,
): Partial<Record<K, number>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, number>);
}

/** Prefer Anthropic parsed structured output over transcript text when present. */
export function anthropicResponseText(
  result: AnthropicParsedMessage,
  assistant: NativeAssistantTurn,
): string {
  return result.parsed_output != null
    ? parsedOutputText(result.parsed_output)
    : assistant.text;
}

function parsedOutputText(parsedOutput: unknown): string {
  return typeof parsedOutput === "string"
    ? parsedOutput
    : JSON.stringify(parsedOutput);
}
