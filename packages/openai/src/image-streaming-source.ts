import type OpenAI from "openai";
import type {
  ImageGenCompletedEvent,
  ImageGenPartialImageEvent,
  ImageGenStreamEvent,
  ImageGenerateParamsStreaming,
} from "openai/resources/images";
import { createGeneratedImageResult } from "@use-crux/core";
import type { NormalizedOpenAIImageStream } from "./image-streaming-options";

/** Open one genuine SDK stream and capture its exact terminal event. */
export async function openOpenAIImageStream(
  client: OpenAI,
  normalized: NormalizedOpenAIImageStream,
  signal: AbortSignal,
  call: <T>(operation: string, start: () => Promise<T>) => Promise<T>,
) {
  const { options, prompt } = normalized;
  const stream = await call("image.generate", () =>
    client.images.generate(
      {
        ...options.extra,
        model: options.model,
        prompt: prompt.text,
        ...(options.n === undefined ? {} : { n: options.n }),
        ...(options.size === undefined ? {} : { size: options.size }),
        stream: true,
      } as ImageGenerateParamsStreaming,
      { signal },
    ),
  );
  if (!isAsyncIterable<ImageGenStreamEvent>(stream)) {
    throw new TypeError(
      "OpenAI image streaming requires an async iterable SDK response.",
    );
  }
  const terminal = deferredTerminal(signal);
  let lastPreviewIndex = -1;
  return {
    events: captureOpenAIImageStream(stream, terminal),
    map(event: ImageGenStreamEvent) {
      if (event.type !== "image_generation.partial_image") return undefined;
      if (
        !Number.isSafeInteger(event.partial_image_index) ||
        event.partial_image_index <= lastPreviewIndex
      ) {
        throw new TypeError(
          "OpenAI image preview indexes must increase monotonically.",
        );
      }
      lastPreviewIndex = event.partial_image_index;
      return {
        type: "image-preview" as const,
        image: imageFromEvent(event),
        outputIndex: 0,
        sequence: event.partial_image_index,
      };
    },
    completion: terminal.promise,
  };
}

/** Decode the terminal SDK event into one ID-free completed image payload. */
export function decodeOpenAIImageStreamCompletion(raw: ImageGenCompletedEvent) {
  const image = imageFromEvent(raw);
  const { b64_json: _data, type: _type, ...metadata } = raw;
  return createGeneratedImageResult([image], {
    raw,
    warnings: [],
    execution: { kind: "native", calls: 1 },
    providerMetadata: Object.freeze(metadata),
  });
}

async function* captureOpenAIImageStream(
  stream: AsyncIterable<ImageGenStreamEvent>,
  terminal: TerminalDeferred,
): AsyncGenerator<ImageGenStreamEvent> {
  try {
    for await (const event of stream) {
      if (event.type === "image_generation.completed") {
        terminal.resolve(event);
      }
      yield event;
    }
    if (!terminal.settled()) {
      terminal.reject(
        new TypeError(
          "OpenAI image stream ended without a completed image event.",
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
          "OpenAI image stream closed before its completed image event.",
        ),
      );
    }
    terminal.dispose();
  }
}

function imageFromEvent(
  event: ImageGenPartialImageEvent | ImageGenCompletedEvent,
) {
  return createGeneratedImageResult(
    [
      {
        data: event.b64_json,
        mediaType: outputMediaType(event.output_format),
      },
    ],
    {
      raw: event,
      warnings: [],
      execution: { kind: "native", calls: 1 },
    },
  ).image;
}

interface TerminalDeferred {
  readonly promise: Promise<ImageGenCompletedEvent>;
  resolve(event: ImageGenCompletedEvent): void;
  reject(error: unknown): void;
  settled(): boolean;
  dispose(): void;
}

function deferredTerminal(signal: AbortSignal): TerminalDeferred {
  let settled = false;
  let resolvePromise!: (event: ImageGenCompletedEvent) => void;
  let rejectPromise!: (error: unknown) => void;
  const promise = new Promise<ImageGenCompletedEvent>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
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
    resolve(event) {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      resolvePromise(event);
    },
    reject: rejectTerminal,
    settled: () => settled,
    dispose: () => signal.removeEventListener("abort", onAbort),
  };
}

function outputMediaType(format: ImageGenCompletedEvent["output_format"]) {
  return format === "jpeg"
    ? "image/jpeg"
    : format === "webp"
      ? "image/webp"
      : "image/png";
}

function isAsyncIterable<T>(value: unknown): value is AsyncIterable<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    Symbol.asyncIterator in value &&
    typeof value[Symbol.asyncIterator] === "function"
  );
}
