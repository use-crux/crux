import type OpenAI from "openai";
import { createGenerateSpeechResult } from "@use-crux/core";
import {
  openAISpeechMediaType,
  openAISpeechRequest,
  type OpenAISpeechInput,
} from "./speech";

type BlobCompatibleBytes = ReturnType<typeof Uint8Array.from>;

export type OpenAISpeechChunk = Readonly<{
  data: Uint8Array;
  sequence: number;
}>;

export type OpenAISpeechStreamCompletion = Readonly<{
  raw: Response;
  audio: Blob;
}>;

/** Open one genuine binary response-body stream from the Speech API. */
export async function openOpenAISpeechStream(
  client: OpenAI,
  options: OpenAISpeechInput,
  signal: AbortSignal,
  call: <T>(operation: string, start: () => Promise<T>) => Promise<T>,
) {
  const raw = await call("audio.speech", () =>
    client.audio.speech.create(openAISpeechRequest(options, "audio"), {
      signal,
    }),
  );
  if (raw.body === null) {
    throw new TypeError(
      "OpenAI speech streaming requires a readable response body.",
    );
  }
  const reader = raw.body.getReader();
  const terminal = deferred<OpenAISpeechStreamCompletion>();
  return {
    events: captureResponseBody(
      raw,
      reader,
      terminal,
      signal,
      openAISpeechMediaType(options.outputFormat),
    ),
    map: ({ data, sequence }: OpenAISpeechChunk) => ({
      type: "audio-delta" as const,
      data,
      mediaType: openAISpeechMediaType(options.outputFormat),
      sequence,
    }),
    completion: terminal.promise,
  };
}

/** Decode the consumed native response into one exact completed audio payload. */
export function decodeOpenAISpeechStreamCompletion(
  native: OpenAISpeechStreamCompletion,
  options: OpenAISpeechInput,
) {
  return createGenerateSpeechResult(
    {
      type: "data",
      data: native.audio,
      mediaType: openAISpeechMediaType(options.outputFormat),
    },
    {
      raw: native.raw,
      warnings: [],
      execution: { kind: "native", calls: 1 },
    },
  );
}

async function* captureResponseBody(
  raw: Response,
  reader: ReadableStreamDefaultReader<Uint8Array>,
  terminal: Deferred<OpenAISpeechStreamCompletion>,
  signal: AbortSignal,
  mediaType: string,
): AsyncGenerator<OpenAISpeechChunk> {
  const chunks: BlobCompatibleBytes[] = [];
  let complete = false;
  let sequence = 0;
  const onAbort = (): void => {
    terminal.reject(signal.reason);
    void reader.cancel(signal.reason).catch(() => undefined);
  };
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    signal.throwIfAborted();
    while (true) {
      const next = await reader.read();
      signal.throwIfAborted();
      if (next.done) {
        complete = true;
        terminal.resolve({
          raw,
          audio: new Blob(chunks, { type: mediaType }),
        });
        return;
      }
      const chunk = blobCompatibleChunk(next.value);
      chunks.push(chunk);
      yield { data: chunk, sequence: sequence++ };
    }
  } catch (error) {
    terminal.reject(error);
    throw error;
  } finally {
    signal.removeEventListener("abort", onAbort);
    if (!complete) {
      void reader.cancel(signal.reason).catch(() => undefined);
    }
    reader.releaseLock();
    chunks.length = 0;
  }
}

function blobCompatibleChunk(chunk: Uint8Array): BlobCompatibleBytes {
  return chunk.buffer instanceof ArrayBuffer
    ? (chunk as BlobCompatibleBytes)
    : Uint8Array.from(chunk);
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let settled = false;
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (error: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve(value) {
      if (settled) return;
      settled = true;
      resolvePromise(value);
    },
    reject(error) {
      if (settled) return;
      settled = true;
      rejectPromise(error);
    },
  };
}
