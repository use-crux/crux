import {
  FinishReason,
  type GenerateContentResponse,
  type GoogleGenAI,
} from "@google/genai";
import { createGenerateSpeechResult } from "@use-crux/core";
import { googleSpeechRequest, type GoogleSpeechInput } from "./speech";

const BASE64 =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const AUDIO_ESSENCE = /^audio\/[a-z0-9!#$&^_.+-]+$/i;

type OwnedBytes = ReturnType<typeof Uint8Array.from>;

export interface GoogleSpeechChunk {
  readonly type: "audio-delta";
  readonly data: OwnedBytes;
  readonly mediaType: string;
  readonly sequence: number;
}

export interface GoogleSpeechStreamCompletion {
  readonly raw: GenerateContentResponse;
  readonly audio: Blob;
  readonly mediaType: string;
}

/** Open one finite Generate Content TTS stream and retain its exact terminal response. */
export async function openGoogleSpeechStream(
  client: GoogleGenAI,
  options: GoogleSpeechInput,
  signal: AbortSignal,
  call: <T>(operation: string, start: () => Promise<T>) => Promise<T>,
) {
  const stream = await call("generation.speech", () =>
    client.models.generateContentStream(googleSpeechRequest(options, signal)),
  );
  if (!isAsyncIterable<GenerateContentResponse>(stream)) {
    throw new TypeError(
      "Google speech streaming requires an async iterable SDK response.",
    );
  }
  const terminal = deferredTerminal(signal);
  const mapper = new GoogleSpeechStreamMapper(terminal);
  return {
    events: captureGoogleSpeechStream(stream, terminal, mapper),
    map(response: GenerateContentResponse) {
      try {
        return mapper.map(response);
      } catch (error) {
        terminal.reject(error);
        throw error;
      }
    },
    completion: terminal.promise,
  };
}

/** Decode retained native PCM chunks into one completed speech payload. */
export function decodeGoogleSpeechStreamCompletion(
  completion: GoogleSpeechStreamCompletion,
) {
  return createGenerateSpeechResult<GenerateContentResponse, never, never>(
    {
      type: "data",
      data: completion.audio,
      mediaType: completion.mediaType,
    },
    {
      raw: completion.raw,
      warnings: [],
      execution: { kind: "native", calls: 1 },
    },
  );
}

class GoogleSpeechStreamMapper {
  readonly #chunks: OwnedBytes[] = [];
  readonly #terminal: TerminalDeferred;
  #mediaType?: string;
  #sequence = 0;
  #terminalSeen = false;

  constructor(terminal: TerminalDeferred) {
    this.#terminal = terminal;
  }

  /** Release provider assembly references after success, failure, or cancellation. */
  dispose(): void {
    this.#chunks.length = 0;
  }

  map(
    response: GenerateContentResponse,
  ): GoogleSpeechChunk | readonly GoogleSpeechChunk[] | undefined {
    if (this.#terminalSeen) {
      throw new TypeError(
        "Google speech stream emitted a response after its terminal response.",
      );
    }
    const candidate = response.candidates?.[0];
    const chunks = (candidate?.content?.parts ?? []).flatMap((part) => {
      if (part.inlineData === undefined) return [];
      const data = decodeAudioChunk(
        part.inlineData.data,
        part.inlineData.mimeType,
        this.#mediaType,
      );
      this.#mediaType ??= part.inlineData.mimeType;
      this.#chunks.push(data);
      return [
        {
          type: "audio-delta" as const,
          data,
          mediaType: part.inlineData.mimeType!,
          sequence: this.#sequence++,
        },
      ];
    });

    if (candidate?.finishReason !== undefined) {
      if (candidate.finishReason !== FinishReason.STOP) {
        throw new Error(
          `Google speech generation stopped with reason "${candidate.finishReason}".`,
          { cause: response },
        );
      }
      if (this.#mediaType === undefined || this.#chunks.length === 0) {
        throw new TypeError(
          "Google speech stream completed without audio bytes.",
        );
      }
      this.#terminalSeen = true;
      this.#terminal.resolve({
        raw: response,
        audio: new Blob(this.#chunks, { type: this.#mediaType }),
        mediaType: this.#mediaType,
      });
    }
    return chunks.length === 0
      ? undefined
      : chunks.length === 1
        ? chunks[0]
        : chunks;
  }
}

function decodeAudioChunk(
  data: string | undefined,
  mediaType: string | undefined,
  expectedMediaType: string | undefined,
): OwnedBytes {
  const essence = mediaType?.split(";", 1)[0]?.trim() ?? "";
  if (mediaType === undefined || !AUDIO_ESSENCE.test(essence)) {
    throw new TypeError(
      "Google speech stream audio chunks must declare an audio MIME type.",
    );
  }
  if (expectedMediaType !== undefined && mediaType !== expectedMediaType) {
    throw new TypeError(
      "Google speech stream changed audio MIME type between chunks.",
    );
  }
  if (
    typeof data !== "string" ||
    data.length === 0 ||
    data.length % 4 !== 0 ||
    !BASE64.test(data)
  ) {
    throw new TypeError(
      "Google speech stream audio chunks must contain valid base64.",
    );
  }
  const decoded = Uint8Array.from(Buffer.from(data, "base64"));
  if (decoded.byteLength === 0) {
    throw new TypeError(
      "Google speech stream audio chunks must not decode to empty bytes.",
    );
  }
  return decoded;
}

async function* captureGoogleSpeechStream(
  stream: AsyncIterable<GenerateContentResponse>,
  terminal: TerminalDeferred,
  mapper: GoogleSpeechStreamMapper,
): AsyncGenerator<GenerateContentResponse> {
  try {
    for await (const response of stream) yield response;
    if (!terminal.settled()) {
      terminal.reject(
        new TypeError(
          "Google speech stream ended without a STOP terminal response.",
        ),
      );
    }
  } catch (error) {
    terminal.reject(error);
    throw error;
  } finally {
    if (!terminal.settled()) {
      terminal.reject(
        new TypeError(
          "Google speech stream closed before its STOP terminal response.",
        ),
      );
    }
    mapper.dispose();
    terminal.dispose();
  }
}

interface TerminalDeferred {
  readonly promise: Promise<GoogleSpeechStreamCompletion>;
  resolve(value: GoogleSpeechStreamCompletion): void;
  reject(error: unknown): void;
  settled(): boolean;
  dispose(): void;
}

function deferredTerminal(signal: AbortSignal): TerminalDeferred {
  let settled = false;
  let resolvePromise!: (value: GoogleSpeechStreamCompletion) => void;
  let rejectPromise!: (error: unknown) => void;
  const promise = new Promise<GoogleSpeechStreamCompletion>(
    (resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    },
  );
  const rejectTerminal = (error: unknown): void => {
    if (settled) return;
    settled = true;
    signal.removeEventListener("abort", onAbort);
    rejectPromise(error);
  };
  const onAbort = () => rejectTerminal(signal.reason);
  signal.addEventListener("abort", onAbort, { once: true });
  return {
    promise,
    resolve(value) {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      resolvePromise(value);
    },
    reject: rejectTerminal,
    settled: () => settled,
    dispose: () => signal.removeEventListener("abort", onAbort),
  };
}

function isAsyncIterable<T>(value: unknown): value is AsyncIterable<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    Symbol.asyncIterator in value &&
    typeof value[Symbol.asyncIterator] === "function"
  );
}
