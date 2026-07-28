import {
  FinishReason,
  GenerateContentResponse,
  MediaModality,
  type Candidate,
  type GoogleGenAI,
} from "@google/genai";
import { vi } from "vitest";

export const PCM_MEDIA_TYPE = "audio/l16; rate=24000; channels=1";

export const firstAudioChunk = audioChunk("AQID");
export const secondAudioChunk = audioChunk("BAUG");
export const terminalResponse = response({
  candidates: [
    {
      content: {},
      finishReason: FinishReason.STOP,
      index: 0,
    } satisfies Candidate,
  ],
  modelVersion: "gemini-3.1-flash-tts-preview",
  responseId: "response-1",
  usageMetadata: {
    promptTokenCount: 5,
    candidatesTokenCount: 13,
    totalTokenCount: 18,
    candidatesTokensDetails: [
      { modality: MediaModality.AUDIO, tokenCount: 13 },
    ],
  },
});

export function audioChunk(
  data: string,
  mimeType = PCM_MEDIA_TYPE,
): GenerateContentResponse {
  return response({
    candidates: [
      {
        content: {
          role: "model",
          parts: [{ inlineData: { data, mimeType } }],
        },
        index: 0,
      },
    ],
  });
}

export function response(
  fields: Partial<GenerateContentResponse>,
): GenerateContentResponse {
  return Object.assign(new GenerateContentResponse(), fields);
}

export function clientWith(chunks: readonly GenerateContentResponse[]) {
  return clientWithResponse(streamFrom(chunks));
}

export function clientWithResponse(response: unknown) {
  const generateContentStream = vi.fn(async () => response);
  return {
    client: { models: { generateContentStream } } as unknown as GoogleGenAI,
    generateContentStream,
  };
}

export function gatedClient(
  beforeGate: readonly GenerateContentResponse[],
  afterGate: readonly GenerateContentResponse[],
) {
  const gate = deferred<void>();
  const waiting = deferred<void>();
  const generateContentStream = vi.fn(async () => ({
    async *[Symbol.asyncIterator]() {
      yield* beforeGate;
      waiting.resolve();
      await gate.promise;
      yield* afterGate;
    },
  }));
  return {
    client: { models: { generateContentStream } } as unknown as GoogleGenAI,
    generateContentStream,
    release: () => gate.resolve(),
    waiting: waiting.promise,
  };
}

export function cancellableClient(chunks: readonly GenerateContentResponse[]) {
  const returned = deferred<void>();
  let requestSignal: AbortSignal | undefined;
  let index = 0;
  const iterator: AsyncIterator<GenerateContentResponse> = {
    next: async () => {
      const chunk = chunks[index++];
      if (chunk !== undefined) return { done: false, value: chunk };
      if (requestSignal?.aborted) throw requestSignal.reason;
      return new Promise<IteratorResult<GenerateContentResponse>>(
        (_resolve, reject) => {
          requestSignal?.addEventListener(
            "abort",
            () => reject(requestSignal?.reason),
            { once: true },
          );
        },
      );
    },
    return: async () => {
      returned.resolve();
      return { done: true, value: undefined };
    },
  };
  const generateContentStream = vi.fn(
    async (request: {
      readonly config?: { readonly abortSignal?: AbortSignal };
    }) => {
      requestSignal = request.config?.abortSignal;
      return { [Symbol.asyncIterator]: () => iterator };
    },
  );
  return {
    client: { models: { generateContentStream } } as unknown as GoogleGenAI,
    generateContentStream,
    requestSignal: () => requestSignal,
    returned: returned.promise,
  };
}

export async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of stream) values.push(value);
  return values;
}

export async function waitFor(
  predicate: () => boolean,
  message: string,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error(message);
}

function streamFrom(chunks: readonly GenerateContentResponse[]) {
  return {
    async *[Symbol.asyncIterator]() {
      yield* chunks;
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}
