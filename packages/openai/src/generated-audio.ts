import type OpenAI from "openai";
import type { AssistantContentPart } from "@use-crux/core";
import type { NativeAssistantReadContext } from "@use-crux/core/adapter";

/** OpenAI chat audio output formats supported by the installed SDK. */
export type OpenAIAudioOutputFormat = "wav" | "aac" | "mp3" | "flac" | "opus" | "pcm16";

/** Decode generated audio bytes and private continuation facts from one assistant message. */
export function generatedOpenAIAudioPart(
  message: OpenAI.ChatCompletionMessage | undefined,
  context: NativeAssistantReadContext | undefined,
): Extract<AssistantContentPart, { type: "audio" }> | undefined {
  const audio = (message as { readonly audio?: { readonly data?: unknown; readonly id?: unknown } } | undefined)?.audio;
  if (typeof audio?.data !== "string") return undefined;
  const format = requestedAudioFormat(context);
  const audioId = typeof audio.id === "string" && audio.id !== "" ? audio.id : undefined;
  return {
    type: "audio",
    source: new Uint8Array(Buffer.from(audio.data, "base64")),
    ...(format ? { mediaType: outputMediaType(format) } : {}),
    ...(format || audioId
      ? {
          providerOptions: {
            openai: {
              ...(format ? { audioFormat: format } : {}),
              ...(audioId ? { audioId } : { audioContinuation: "unavailable" }),
            },
          },
        }
      : {}),
  };
}

function requestedAudioFormat(context: NativeAssistantReadContext | undefined): OpenAIAudioOutputFormat | undefined {
  const request = context?.request;
  if (!isRecord(request) || !isRecord(request.audio)) return undefined;
  const format = request.audio.format;
  return format === "wav" || format === "aac" || format === "mp3" || format === "flac" || format === "opus" || format === "pcm16"
    ? format
    : undefined;
}

function outputMediaType(format: OpenAIAudioOutputFormat): string {
  switch (format) {
    case "wav": return "audio/wav";
    case "aac": return "audio/aac";
    case "mp3": return "audio/mpeg";
    case "flac": return "audio/flac";
    case "opus": return "audio/opus";
    case "pcm16": return "audio/pcm";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
