import type { GenerateContentResponse } from "@google/genai";
import type { StreamCompletionMetadata } from "@use-crux/core/adapter";
import { googleTranscript } from "./message-codec";
import { googleResponseMeta, googleResponseText } from "./response";

/** Extract a text delta from a Google GenAI stream chunk. */
export function googleTextDelta(chunk: unknown): string | undefined {
  if (!isRecord(chunk) || !Array.isArray(chunk.candidates)) return undefined;
  const candidate = chunk.candidates[0];
  if (
    !isRecord(candidate) ||
    !isRecord(candidate.content) ||
    !Array.isArray(candidate.content.parts)
  ) {
    return undefined;
  }
  const firstPart = candidate.content.parts[0];
  if (!isRecord(firstPart)) return undefined;
  return typeof firstPart.text === "string" ? firstPart.text : undefined;
}

/** Reconstruct exact completion facts from consumed Google stream chunks. */
export async function googleStreamCompletion(
  chunks: readonly unknown[],
): Promise<StreamCompletionMetadata | undefined> {
  const responses = chunks.filter(isResponse);
  const last = responses.at(-1);
  if (!last) return undefined;
  const response = {
    ...last,
    candidates: [
      {
        ...last.candidates?.[0],
        content: {
          ...last.candidates?.[0]?.content,
          role: "model",
          parts: responses.flatMap(
            (chunk) => chunk.candidates?.[0]?.content?.parts ?? [],
          ),
        },
      },
    ],
  } as GenerateContentResponse;
  const assistant = googleTranscript.readAssistant(response);
  const content =
    typeof assistant.content === "string"
      ? [{ type: "text" as const, text: assistant.content }]
      : assistant.content;
  return {
    ...googleResponseMeta(last),
    text: googleResponseText(response, assistant),
    ...(content !== undefined ? { content } : {}),
    ...(assistant.toolCalls !== undefined
      ? { toolCalls: [...assistant.toolCalls] }
      : {}),
  };
}

function isResponse(value: unknown): value is GenerateContentResponse {
  return isRecord(value) && Array.isArray(value.candidates);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
