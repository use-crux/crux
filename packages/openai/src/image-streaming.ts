import type OpenAI from "openai";
import type { ImageGenCompletedEvent } from "openai/resources/images";
import type { StreamImage, StreamImageResult } from "@use-crux/core";
import { defineStreamingOperation } from "@use-crux/core/adapter";
import {
  normalizeOpenAIImageStream,
  supportsOpenAIImageStream,
  type OpenAIImageStreamExtra,
  type OpenAIImageStreamInput,
} from "./image-streaming-options";
import {
  decodeOpenAIImageStreamCompletion,
  openOpenAIImageStream,
} from "./image-streaming-source";

export type { OpenAIImageStreamExtra } from "./image-streaming-options";

/** Payload-free metadata copied from the exact OpenAI terminal event. */
export type OpenAIImageStreamMetadata = Omit<
  ImageGenCompletedEvent,
  "b64_json" | "type"
>;

/** Exact completed result of an OpenAI Images API stream. */
export type OpenAIStreamImageResult = StreamImageResult<
  ImageGenCompletedEvent,
  OpenAIImageStreamMetadata,
  never
>;

/**
 * Genuine single-output OpenAI image stream attached to a bound adapter.
 *
 * Complete partial images replace the prior preview for `outputIndex: 0`.
 * Enforcing output-media Safety evaluates each complete preview before
 * publication and releases final media only after terminal validation. Every
 * `fullStream` reader replays the same in-memory events; returning from one
 * reader only detaches it, while `cancel()` aborts the operation. The first
 * published event commits routing. The final event and `completion.image`
 * share the same guarded asset, and Crux never persists either implicitly.
 *
 * @example
 * ```ts
 * const result = await openai.streamImage({
 *   model: 'gpt-image-2',
 *   prompt: 'A quiet canal at sunrise',
 *   extra: { partial_images: 2 },
 * })
 *
 * for await (const event of result.fullStream) {
 *   if (event.type === 'image-preview') render(event.image)
 * }
 * ```
 */
export type OpenAIStreamImage = StreamImage<
  string,
  OpenAIImageStreamExtra,
  ImageGenCompletedEvent,
  OpenAIImageStreamMetadata,
  never
>;

/** Define native OpenAI Images API streaming mechanics. */
export function createOpenAIImageStreamingOperation(client: OpenAI) {
  return defineStreamingOperation({
    normalize: (input: OpenAIImageStreamInput, context) =>
      normalizeOpenAIImageStream(input, context.model),
    support: (normalized) =>
      supportsOpenAIImageStream(normalized)
        ? ("supported" as const)
        : ("unsupported" as const),
    open: (normalized, { signal, call }) =>
      openOpenAIImageStream(client, normalized, signal, call),
    validate: decodeOpenAIImageStreamCompletion,
    report: () => ({ kind: "image" as const, count: 1 }),
    conformance: [],
  });
}
