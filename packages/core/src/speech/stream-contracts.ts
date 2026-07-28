import type { DataAsset } from "../asset/types";
import type { StreamingOperationResult } from "../adapter/streaming-operation";
import type { GenerateSpeechOptions, GenerateSpeechResult } from "./contracts";
import type {
  CompletedOperationModelGuard,
  RoutingCallOptions,
} from "../routing/types";

type SpeechStreamStartEvent = Readonly<{
  /** Core-owned start of the logical operation, not a provider attempt. */
  type: "start";
}>;

type SpeechDeltaStreamEvent = Readonly<{
  /** Append-only encoded audio bytes. */
  type: "audio-delta";
  /** Byte view retained by the logical operation without a replay copy. */
  data: Uint8Array;
  /** Media type of the audio bytes being assembled. */
  mediaType: string;
  /** Zero-based sequence within the generated audio output. */
  sequence: number;
}>;

type SpeechFinalStreamEvent = Readonly<{
  /** Final validated audio shared with `completion`. */
  type: "audio";
  /** Required audio asset after output Safety. */
  audio: DataAsset;
}>;

type SpeechStreamFinishEvent = Readonly<{
  /** Successful end of the logical operation. Failures never emit `finish`. */
  type: "finish";
}>;

/**
 * Canonical progressive evidence from one bounded speech generation.
 *
 * Audio deltas are append-only bytes and may not be independently playable.
 * Final audio publishes only after native completion, validation, and output
 * Safety. Terminal failures throw from the stream instead of becoming events.
 */
export type SpeechStreamEvent =
  | SpeechStreamStartEvent
  | SpeechDeltaStreamEvent
  | SpeechFinalStreamEvent
  | SpeechStreamFinishEvent;

/**
 * Managed speech stream whose completion is the exact generated-speech result.
 *
 * Provider `raw`, metadata, and warning types flow through unchanged. The final
 * audio event shares object identity with the resolved result.
 *
 * @typeParam TRaw - Exact provider terminal response retained by `completion`.
 * @typeParam TMetadata - Provider facts that exclude media payloads.
 * @typeParam TWarning - Provider warning element type.
 */
export type StreamSpeechResult<
  TRaw = unknown,
  TMetadata = unknown,
  TWarning = unknown,
> = StreamingOperationResult<
  SpeechStreamEvent,
  GenerateSpeechResult<TRaw, TMetadata, TWarning>
>;

/**
 * Portable options accepted by a bounded speech stream.
 *
 * @typeParam TModel - Direct model or routing expression selected by the call.
 * @typeParam TVoice - Provider-supported voice names.
 * @typeParam TExtra - Provider-owned streaming controls.
 */
export type StreamSpeechOptions<
  TModel = string,
  TVoice = string,
  TExtra = never,
> = GenerateSpeechOptions<TModel, TVoice, TExtra>;

/**
 * Start one genuine bounded speech stream.
 *
 * Execution begins after support and input-Safety preflight. Each
 * `fullStream` reader replays the same canonical history independently.
 * Audio deltas are append-only and may be retained until final output Safety;
 * the first published event commits routing. Calling
 * {@link StreamingOperationResult.cancel | cancel()} aborts the whole logical
 * operation. Crux does not persist any audio.
 *
 * @example
 * ```ts
 * const result = await streamSpeech({
 *   model: 'speech-1',
 *   text: 'Welcome aboard',
 *   voice: 'alloy',
 * })
 *
 * for await (const event of result.fullStream) {
 *   if (event.type === 'audio-delta') play(event.data)
 * }
 *
 * await assetStore.put((await result.completion).audio)
 * ```
 *
 * @typeParam TModel - Models accepted directly or through routing.
 * @typeParam TVoice - Provider-supported voice names.
 * @typeParam TExtra - Provider-owned streaming controls.
 * @typeParam TRaw - Exact provider terminal response.
 * @typeParam TMetadata - Provider facts that exclude media payloads.
 * @typeParam TWarning - Provider warning element type.
 */
export type StreamSpeech<
  TModel = string,
  TVoice = string,
  TExtra = never,
  TRaw = unknown,
  TMetadata = unknown,
  TWarning = unknown,
> = ((
  options: StreamSpeechOptions<TModel, TVoice, TExtra>,
) => Promise<StreamSpeechResult<TRaw, TMetadata, TWarning>>) &
  (<TSelectedModel>(
    options: Omit<StreamSpeechOptions<TModel, TVoice, TExtra>, "model"> &
      Readonly<{ model: TSelectedModel }> &
      CompletedOperationModelGuard<TModel, TSelectedModel> &
      RoutingCallOptions<TSelectedModel>,
  ) => Promise<StreamSpeechResult<TRaw, TMetadata, TWarning>>);
