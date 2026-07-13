import type OpenAI from "openai";
import type { ChatCompletion } from "openai/resources/chat/completions";
import type {
  AdapterResponse,
  CruxFinishReason,
  NativeAssistantTurn,
  NativeResponseMetadata,
} from "@use-crux/core/adapter";
import { openAITranscript } from "./message-codec";

/** Normalize an OpenAI chat completion into Crux's canonical adapter response. */
export function openAIResponse(result: ChatCompletion): AdapterResponse {
  const assistant = openAITranscript.readAssistant(result);
  const text = openAIResponseText(result, assistant);
  const content =
    text !== assistant.text
      ? [{ type: "text" as const, text }]
      : typeof assistant.content === "string"
        ? [{ type: "text" as const, text: assistant.content }]
        : assistant.content;
  return {
    ...openAIResponseMeta(result),
    text,
    ...(content !== undefined ? { content } : {}),
    toolCalls: assistant.toolCalls,
  };
}

/** Read response metadata that is not owned by OpenAI transcript conversion. */
export function openAIResponseMeta(
  result: ChatCompletion,
): NativeResponseMetadata {
  const choice = result.choices?.[0];
  const refusal = (choice?.message as { refusal?: unknown } | undefined)
    ?.refusal;

  return {
    usage: openAIUsage(result.usage ?? undefined),
    finishReason: mapOpenAIFinishReason(choice?.finish_reason, refusal),
    responseId: result.id,
    actualModelId: result.model,
  };
}

/** OpenAI chat/stream usage shape shared by non-streaming and streaming completion. */
export interface OpenAIUsageShape {
  readonly prompt_tokens: number;
  readonly completion_tokens: number;
  readonly total_tokens: number;
  readonly prompt_tokens_details?: { readonly cached_tokens?: number } | null;
  readonly completion_tokens_details?: {
    readonly reasoning_tokens?: number;
  } | null;
}

/** Normalize OpenAI usage counts into the canonical token-usage shape. */
export function openAIUsage(
  usage: OpenAIUsageShape | undefined,
): NativeResponseMetadata["usage"] {
  if (usage === undefined) return undefined;
  return {
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
    inputTokenDetails: {
      ...optionalTokenDetail(
        "cacheReadTokens",
        usage.prompt_tokens_details?.cached_tokens,
      ),
    },
    outputTokenDetails: {
      ...optionalTokenDetail(
        "reasoningTokens",
        usage.completion_tokens_details?.reasoning_tokens,
      ),
    },
  };
}

/**
 * Normalize an OpenAI `finish_reason` and optional refusal into the
 * provider-neutral finish reason.
 */
export function mapOpenAIFinishReason(
  finishReason: string | null | undefined,
  refusal?: unknown,
): CruxFinishReason | undefined {
  if (typeof refusal === "string" && refusal.length > 0) return "refusal";
  switch (finishReason) {
    case null:
    case undefined:
      return undefined;
    case "stop":
      return "stop";
    case "length":
      return "length";
    case "tool_calls":
    case "function_call":
      return "tool-calls";
    case "content_filter":
      return "content-filter";
    default:
      return "unknown";
  }
}

function optionalTokenDetail<K extends string>(
  key: K,
  value: number | undefined,
): Partial<Record<K, number>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, number>);
}

/** Prefer OpenAI parsed structured output over transcript text when present. */
export function openAIResponseText(
  result: ChatCompletion,
  assistant: NativeAssistantTurn,
): string {
  const choiceMessage = result.choices?.[0]?.message as
    | (OpenAI.ChatCompletionMessage & { readonly parsed?: unknown })
    | undefined;
  if (choiceMessage?.parsed == null) return assistant.text;
  return typeof choiceMessage.parsed === "string"
    ? choiceMessage.parsed
    : JSON.stringify(choiceMessage.parsed);
}
