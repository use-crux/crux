import type {
  ChatCompletion,
  ChatCompletionChunk,
} from "openai/resources/chat/completions";
import {
  classifyProviderHttpError,
  CruxAdapterError,
  cruxProviderError,
  type StreamCompletionMetadata,
} from "@use-crux/core/adapter";
import { openAITranscript } from "./message-codec";
import { openAIResponseMeta } from "./response";
import type { OpenAIChatRequest } from "./types";

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

/** Stream wrapper that normalizes mid-stream provider iteration errors. */
export class OpenAIChatStream implements AsyncIterable<ChatCompletionChunk> {
  readonly #raw: AsyncIterable<ChatCompletionChunk>;

  constructor(raw: AsyncIterable<ChatCompletionChunk>) {
    this.#raw = raw;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<ChatCompletionChunk> {
    try {
      for await (const chunk of this.#raw) {
        yield chunk;
      }
    } catch (error) {
      throw new CruxAdapterError(
        classifyProviderHttpError(error, "openai") ??
          cruxProviderError({
            kind: "provider-error",
            code: "openai.stream_failed",
            retryable: true,
            message: error instanceof Error ? error.message : error,
          }),
        { cause: error },
      );
    }
  }
}

/** Wrap a raw OpenAI chat stream so mid-stream errors are provider-normalized. */
export function createOpenAIStreamCapture(
  raw: AsyncIterable<ChatCompletionChunk>,
): OpenAIChatStream {
  return new OpenAIChatStream(raw);
}

/** Reconstruct exact completion facts from consumed OpenAI chat chunks. */
export async function openAIStreamCompletion(
  chunks: readonly unknown[],
  request?: OpenAIChatRequest,
): Promise<StreamCompletionMetadata | undefined> {
  const values = chunks.filter(isChunk);
  return completionMetadataFromChunks(values, request);
}

function completionMetadataFromChunks(
  values: readonly ChatCompletionChunk[],
  request?: OpenAIChatRequest,
): StreamCompletionMetadata | undefined {
  const last = values.at(-1);
  if (!last) return undefined;
  const lastChoice = lastStreamChoice(values);
  const text = values.flatMap((chunk) => textDelta(chunk)).join("");
  const refusal = values.flatMap((chunk) => refusalDelta(chunk)).join("");
  const audioData = values.flatMap((chunk) => audioDelta(chunk)).join("");
  const audioId = values
    .map((chunk) => audioIdDelta(chunk))
    .find((id) => id !== undefined);
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
          refusal: refusal || null,
          ...(audioData
            ? {
                audio: {
                  data: audioData,
                  transcript: text,
                  ...(audioId ? { id: audioId } : {}),
                },
              }
            : {}),
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
      },
    ],
    ...(last.usage ? { usage: last.usage } : {}),
  } as unknown as ChatCompletion;
  const assistant = openAITranscript.readAssistant(result, { request });
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

function refusalDelta(chunk: ChatCompletionChunk): string[] {
  const value = chunk.choices[0]?.delta?.refusal;
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

function audioIdDelta(chunk: ChatCompletionChunk): string | undefined {
  const audio = (
    chunk.choices[0]?.delta as
      | { readonly audio?: { readonly id?: unknown } }
      | undefined
  )?.audio;
  return typeof audio?.id === "string" && audio.id !== ""
    ? audio.id
    : undefined;
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
