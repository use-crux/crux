import type OpenAI from "openai";
import type {
  ImageGenCompletedEvent,
  ImageGenPartialImageEvent,
  ImageGenStreamEvent,
} from "openai/resources/images";
import { vi } from "vitest";
import type { ImageStreamEvent } from "@use-crux/core";

export const firstPreview = partialImage(0, "AQI=");
export const secondPreview = partialImage(1, "AwQ=");
export const completed = {
  type: "image_generation.completed",
  b64_json: "BQY=",
  background: "opaque",
  created_at: 1_721_000_000,
  output_format: "webp",
  quality: "high",
  size: "1024x1024",
  usage: {
    input_tokens: 11,
    input_tokens_details: { image_tokens: 0, text_tokens: 11 },
    output_tokens: 17,
    total_tokens: 28,
  },
} as const satisfies ImageGenCompletedEvent;

export function partialImage(
  partial_image_index: number,
  b64_json: string,
): ImageGenPartialImageEvent {
  return {
    type: "image_generation.partial_image",
    b64_json,
    background: "opaque",
    created_at: 1_721_000_000,
    output_format: "webp",
    partial_image_index,
    quality: "high",
    size: "1024x1024",
  };
}

export function clientWith(events: readonly ImageGenStreamEvent[]) {
  return clientWithResponse(streamFrom(events));
}

export function clientWithResponse(response: unknown) {
  const generate = vi.fn(async () => response);
  return {
    client: { images: { generate } } as unknown as OpenAI,
    generate,
  };
}

export function cancellableClient(events: readonly ImageGenStreamEvent[]) {
  const returned = deferred<void>();
  let requestSignal: AbortSignal | undefined;
  let index = 0;
  const iterator: AsyncIterator<ImageGenStreamEvent> = {
    next: async () => {
      const event = events[index++];
      if (event !== undefined) return { done: false, value: event };
      if (requestSignal?.aborted) throw requestSignal.reason;
      return new Promise<IteratorResult<ImageGenStreamEvent>>(
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
  const generate = vi.fn(
    async (_input: unknown, request?: { readonly signal?: AbortSignal }) => {
      requestSignal = request?.signal;
      return { [Symbol.asyncIterator]: () => iterator };
    },
  );
  return {
    client: { images: { generate } } as unknown as OpenAI,
    generate,
    requestSignal: () => requestSignal,
    returned: returned.promise,
  };
}

export function dataBytes(
  asset:
    | Extract<
        ImageStreamEvent,
        { readonly type: "image-preview" | "image" }
      >["image"]
    | undefined,
): Uint8Array {
  if (!asset || asset.type !== "data" || !(asset.data instanceof Uint8Array)) {
    throw new Error("Expected an inline image.");
  }
  return asset.data;
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

function streamFrom(events: readonly ImageGenStreamEvent[]) {
  return {
    async *[Symbol.asyncIterator]() {
      yield* events;
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
