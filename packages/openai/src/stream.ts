import type {
  ChatCompletion,
  ChatCompletionChunk,
} from "openai/resources/chat/completions";
import type { StreamCompletionMetadata } from "@use-crux/core/adapter";
import { openAITranscript } from "./message-codec";
import { openAIResponseMeta } from "./response";

/** Extract a text delta from an OpenAI chat-completion stream chunk. */
export function openAITextDelta(chunk: unknown): string | undefined {
  if (!isRecord(chunk) || !Array.isArray(chunk.choices)) return undefined;
  const firstChoice = chunk.choices[0];
  if (!isRecord(firstChoice) || !isRecord(firstChoice.delta)) return undefined;
  const content = firstChoice.delta.content;
  return typeof content === "string" ? content : undefined;
}

/** Compile-time alias used by native chat stream bindings. */
export type OpenAIChatStreamChunk = ChatCompletionChunk;

/** Reconstruct exact completion facts from consumed OpenAI chat chunks. */
export async function openAIStreamCompletion(
  chunks: readonly unknown[],
): Promise<StreamCompletionMetadata | undefined> {
  const values = chunks.filter(isChunk);
  const last = values.at(-1);
  if (!last) return undefined;
  const lastChoice = lastStreamChoice(values);
  const text = values.flatMap((chunk) => textDelta(chunk)).join("");
  const audioData = values.flatMap((chunk) => audioDelta(chunk)).join("");
  const toolCalls = collectToolCalls(values);
  const result = {
    id: last.id,
    object: "chat.completion",
    created: last.created,
    model: last.model,
    choices: [
      {
        index: 0,
        finish_reason: lastChoice?.finish_reason ?? null,
        logprobs: null,
        message: {
          role: "assistant",
          content: text || null,
          refusal: null,
          ...(audioData
            ? {
                audio: {
                  id: "",
                  expires_at: 0,
                  data: audioData,
                  transcript: text,
                },
              }
            : {}),
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
      },
    ],
    ...(last.usage ? { usage: last.usage } : {}),
  } as unknown as ChatCompletion;
  const assistant = openAITranscript.readAssistant(result);
  const content =
    typeof assistant.content === "string"
      ? [{ type: "text" as const, text: assistant.content }]
      : assistant.content;
  return {
    ...openAIResponseMeta(result),
    text: assistant.text,
    ...(content !== undefined ? { content } : {}),
    ...(assistant.toolCalls !== undefined
      ? { toolCalls: [...assistant.toolCalls] }
      : {}),
  };
}

function lastStreamChoice(
  chunks: readonly ChatCompletionChunk[],
): ChatCompletionChunk.Choice | undefined {
  for (let index = chunks.length - 1; index >= 0; index -= 1) {
    const choice = chunks[index]?.choices[0];
    if (choice) return choice;
  }
  return undefined;
}

function textDelta(chunk: ChatCompletionChunk): string[] {
  const value = chunk.choices[0]?.delta?.content;
  return typeof value === "string" ? [value] : [];
}

function audioDelta(chunk: ChatCompletionChunk): string[] {
  const audio = (
    chunk.choices[0]?.delta as
      | { readonly audio?: { readonly data?: unknown } }
      | undefined
  )?.audio;
  return typeof audio?.data === "string" ? [audio.data] : [];
}

function collectToolCalls(chunks: readonly ChatCompletionChunk[]) {
  const calls = new Map<
    number,
    { id: string; name: string; arguments: string }
  >();
  for (const chunk of chunks) {
    const deltas = chunk.choices[0]?.delta?.tool_calls ?? [];
    for (const delta of deltas) {
      const current = calls.get(delta.index) ?? {
        id: "",
        name: "",
        arguments: "",
      };
      calls.set(delta.index, {
        id: current.id + (delta.id ?? ""),
        name: current.name + (delta.function?.name ?? ""),
        arguments: current.arguments + (delta.function?.arguments ?? ""),
      });
    }
  }
  return [...calls.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, call]) => ({
      id: call.id,
      type: "function" as const,
      function: { name: call.name, arguments: call.arguments },
    }));
}

function isChunk(value: unknown): value is ChatCompletionChunk {
  return isRecord(value) && Array.isArray(value.choices);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
