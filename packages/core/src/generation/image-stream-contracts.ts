import type { Asset } from "../asset/types";
import type { StreamingOperationResult } from "../adapter/streaming-operation";
import type {
  GenerateImageOptions,
  GenerateImageResult,
  ImagePrompt,
} from "./image-contracts";
import type {
  CompletedOperationModelGuard,
  RoutingCallOptions,
} from "../routing/types";

type ImageStreamStartEvent = Readonly<{
  /** Core-owned start of the logical operation, not a provider attempt. */
  type: "start";
}>;

type ImagePreviewStreamEvent = Readonly<{
  /** A complete renderable image that remains provisional. */
  type: "image-preview";
  /** Complete preview asset authorized for this occurrence by Safety. */
  image: Asset;
  /** Stable provider output slot replaced by later previews for this slot. */
  outputIndex: number;
  /** Zero-based preview sequence within this output slot. */
  sequence: number;
}>;

type ImageDeltaStreamEvent = Readonly<{
  /** Append-only encoded bytes that may not be independently renderable. */
  type: "image-delta";
  /** Byte view retained by the logical operation without a replay copy. */
  data: Uint8Array;
  /** Media type of the image bytes being assembled. */
  mediaType: string;
  /** Stable provider output slot receiving these bytes. */
  outputIndex: number;
  /** Zero-based delta sequence within this output slot. */
  sequence: number;
}>;

type ImageFinalStreamEvent = Readonly<{
  /** A final validated image shared with `completion`. */
  type: "image";
  /** Final asset after output Safety and retention. */
  image: Asset;
  /** Original provider output slot, stable across sibling strips. */
  outputIndex: number;
}>;

type ImageStreamFinishEvent = Readonly<{
  /** Successful end of the logical operation. Failures never emit `finish`. */
  type: "finish";
}>;

/**
 * Canonical progressive evidence from one bounded image generation.
 *
 * A preview is a complete provisional replacement for the same `outputIndex`;
 * a delta is append-only data and may be undecodable on its own. Final images
 * publish only after native completion, validation, and output Safety.
 * Terminal failures throw from the stream instead of becoming events.
 */
export type ImageStreamEvent =
  | ImageStreamStartEvent
  | ImagePreviewStreamEvent
  | ImageDeltaStreamEvent
  | ImageFinalStreamEvent
  | ImageStreamFinishEvent;

/**
 * Managed image stream whose completion is the exact generated-image result.
 *
 * Provider `raw`, metadata, and warning types flow through unchanged. Final
 * event assets share object identity with the resolved result.
 *
 * @typeParam TRaw - Exact provider terminal response retained by `completion`.
 * @typeParam TMetadata - Provider facts that exclude media payloads.
 * @typeParam TWarning - Provider warning element type.
 */
export type StreamImageResult<
  TRaw = unknown,
  TMetadata = unknown,
  TWarning = unknown,
> = StreamingOperationResult<
  ImageStreamEvent,
  GenerateImageResult<TRaw, TMetadata, TWarning>
>;

/**
 * Portable options accepted by a bounded image stream.
 *
 * @typeParam TModel - Direct model or routing expression selected by the call.
 * @typeParam TExtra - Provider-owned streaming controls.
 * @typeParam TPrompt - Text-only or reference-image prompt shape.
 */
export type StreamImageOptions<
  TModel = string,
  TExtra = never,
  TPrompt extends ImagePrompt = ImagePrompt,
> = GenerateImageOptions<TModel, TExtra, TPrompt>;

/**
 * Start one genuine bounded image stream.
 *
 * Execution begins after support and input-Safety preflight. Each
 * `fullStream` reader replays the same canonical history independently.
 * Complete previews are provisional Safety-guarded replacements; incomplete
 * deltas may be retained until final output Safety. The first published event
 * commits routing, while {@link StreamingOperationResult.cancel | cancel()}
 * aborts the whole logical operation. Crux does not persist any image.
 *
 * @example
 * ```ts
 * const result = await streamImage({
 *   model: 'image-1',
 *   prompt: 'A quiet canal at sunrise',
 * })
 *
 * for await (const event of result.fullStream) {
 *   if (event.type === 'image-preview') render(event.image)
 * }
 *
 * await assetStore.put((await result.completion).image)
 * ```
 *
 * @typeParam TModel - Models accepted directly or through routing.
 * @typeParam TExtra - Provider-owned streaming controls.
 * @typeParam TRaw - Exact provider terminal response.
 * @typeParam TMetadata - Provider facts that exclude media payloads.
 * @typeParam TWarning - Provider warning element type.
 */
export type StreamImage<
  TModel = string,
  TExtra = never,
  TRaw = unknown,
  TMetadata = unknown,
  TWarning = unknown,
> = ((
  options: StreamImageOptions<TModel, TExtra, ImagePrompt>,
) => Promise<StreamImageResult<TRaw, TMetadata, TWarning>>) &
  (<TPrompt extends ImagePrompt, TSelectedModel = TModel>(
    options: StreamImageOptions<TSelectedModel, TExtra, TPrompt> &
      CompletedOperationModelGuard<TModel, TSelectedModel> &
      RoutingCallOptions<TSelectedModel>,
  ) => Promise<StreamImageResult<TRaw, TMetadata, TWarning>>);
