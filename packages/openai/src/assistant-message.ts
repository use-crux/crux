import type OpenAI from "openai";
import { createUnsupportedCapabilityError, type AssistantContentPart } from "@use-crux/core";
import type { ProviderToolCall } from "@use-crux/core/adapter";

/** Encode a canonical assistant turn, including native generated-audio continuation. */
export function encodeOpenAIAssistant(
  content: string | readonly AssistantContentPart[],
  toolCalls: readonly ProviderToolCall[],
): OpenAI.ChatCompletionMessageParam {
  const text = typeof content === "string"
    ? content
    : content.filter((part) => part.type === "text").map((part) => part.text).join("");
  const audioParts = typeof content === "string" ? [] : content.filter((part) => part.type === "audio");
  const unsupportedPart = typeof content === "string"
    ? undefined
    : content.find((part) => part.type !== "text" && part.type !== "audio" && part.type !== "tool-call" && part.type !== "reasoning");
  if (unsupportedPart) throw unsupportedAssistantMedia(unsupportedPart.type);
  if (audioParts.length > 1) throw unsupportedAssistantMedia("multiple-audio");
  const audioId = audioParts.length === 1 ? readAudioId(audioParts[0]!) : undefined;
  if (audioParts.length === 1 && !audioId) throw unsupportedAssistantMedia("audio-continuation");

  const base = {
    role: "assistant" as const,
    content: text || null,
    ...(audioId ? { audio: { id: audioId } } : {}),
  };
  if (toolCalls.length === 0) return base;
  return {
    ...base,
    tool_calls: toolCalls.map((toolCall) => ({
      id: toolCall.id,
      type: "function" as const,
      function: { name: toolCall.name, arguments: encodeArguments(toolCall.args) },
    })),
  };
}

function readAudioId(part: Extract<AssistantContentPart, { type: "audio" }>): string | undefined {
  const value = part.providerOptions?.openai?.audioId;
  return typeof value === "string" && value !== "" ? value : undefined;
}

function encodeArguments(args: unknown): string {
  return typeof args === "string" ? args : JSON.stringify(args);
}

function unsupportedAssistantMedia(kind: string): never {
  throw createUnsupportedCapabilityError({
    adapter: "openai",
    model: "<custom>",
    issues: [{
      capability: `input.media.assistant.${kind}`,
      remediation: kind === "audio-continuation"
        ? "Continue generated OpenAI audio only when the response supplied its native audio id."
        : "OpenAI assistant continuation accepts text and one generated audio reference.",
    }],
  });
}
