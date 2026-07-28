import type { GoogleGenAI, Interactions } from "@google/genai";
import {
  createGeneratedImageResult,
  type StreamImage,
  type StreamImageResult,
} from "@use-crux/core";
import { defineStreamingOperation } from "@use-crux/core/adapter";
import {
  normalizeGoogleImageStream,
  supportsGoogleImageStream,
  type GoogleImageStreamInput,
} from "./image-streaming-options";
import {
  openGoogleImageStream,
  type GoogleImageStreamCompletion,
} from "./image-streaming-source";

/** Payload-free facts copied from the terminal interaction resource. */
export interface GoogleImageStreamMetadata {
  readonly interactionId: string;
  readonly status: "completed";
  readonly model?: string;
  readonly created?: string;
  readonly updated?: string;
  readonly usage?: Interactions.Usage;
}

/** Exact completed result of a Google Interactions image stream. */
export type GoogleStreamImageResult = StreamImageResult<
  Interactions.InteractionCompletedEvent,
  GoogleImageStreamMetadata,
  never
>;

/**
 * Genuine Google Interactions image stream attached to a bound adapter.
 *
 * Each `image-delta` contains append-only bytes for a stable dense
 * `outputIndex`; unlike OpenAI's complete replacement previews, an individual
 * Google delta may not be independently renderable. Final guarded image assets
 * preserve those output indexes and share identity with `completion.images`.
 * Enforcing output-media Safety retains provisional deltas until final
 * assembly. Every `fullStream` reader replays one in-memory history; returning
 * from one reader only detaches it, while `cancel()` aborts the operation. The
 * first published event commits routing, and Crux never persists the bytes.
 *
 * @example
 * ```ts
 * const result = await google.streamImage({
 *   model: 'gemini-3.1-flash-image',
 *   prompt: 'A quiet canal at sunrise',
 * })
 *
 * for await (const event of result.fullStream) {
 *   if (event.type === 'image-delta') appendBytes(event.outputIndex, event.data)
 * }
 * ```
 */
export type GoogleStreamImage = StreamImage<
  string,
  never,
  Interactions.InteractionCompletedEvent,
  GoogleImageStreamMetadata,
  never
>;

/** Define current Google 2.x Interactions image-streaming mechanics. */
export function createGoogleImageStreamingOperation(client: GoogleGenAI) {
  return defineStreamingOperation({
    normalize: (input: GoogleImageStreamInput, context) =>
      normalizeGoogleImageStream(input, context.model),
    support: (normalized) =>
      supportsGoogleImageStream(normalized)
        ? ("supported" as const)
        : ("unsupported" as const),
    open: (normalized, { signal, call }) =>
      openGoogleImageStream(client, normalized, signal, call),
    validate: decodeGoogleImageStreamCompletion,
    report: (result) => ({
      kind: "image" as const,
      count: result.images.length,
    }),
    conformance: [],
  });
}

/** Decode the exact terminal envelope without replacing it by `.interaction`. */
export function decodeGoogleImageStreamCompletion(
  completion: GoogleImageStreamCompletion,
) {
  const { interaction } = completion.raw;
  return createGeneratedImageResult(completion.images, {
    raw: completion.raw,
    warnings: [],
    execution: { kind: "native", calls: 1 },
    providerMetadata: Object.freeze({
      interactionId: interaction.id,
      status: "completed" as const,
      ...(interaction.model === undefined ? {} : { model: interaction.model }),
      ...(interaction.created === undefined
        ? {}
        : { created: interaction.created }),
      ...(interaction.updated === undefined
        ? {}
        : { updated: interaction.updated }),
      ...(interaction.usage === undefined ? {} : { usage: interaction.usage }),
    }),
  });
}
