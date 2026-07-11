import type { DataAsset } from "../asset/types";
import type {
  CompletedOperationResult,
  OperationTimeout,
} from "../completed-operation/contracts";
import type { AnyRoutable, RoutingCallOptions } from "../routing/types";

/** Portable controls accepted by a flat speech-generation operation. */
export type GenerateSpeechOptions<
  TModel = string,
  TVoice = string,
  TExtra = never,
> = Readonly<{
  model: TModel;
  text: string;
  /** Adapter-typed string or structured native voice selection. */
  voice?: TVoice;
  outputFormat?: string;
  instructions?: string;
  speed?: number;
  language?: string;
  abortSignal?: AbortSignal;
  timeout?: OperationTimeout;
  /** Provider-native controls with no portable Crux equivalent. */
  extra?: TExtra;
}>;

/** Result of one speech operation with immediately usable audio bytes. */
export type GenerateSpeechResult<
  TRaw = unknown,
  TMetadata = unknown,
  TWarning = unknown,
> = CompletedOperationResult<TRaw, TMetadata, TWarning> &
  Readonly<{ audio: DataAsset }>;

/**
 * Flat stateless speech-generation function. Provider errors propagate unchanged.
 *
 * @example
 * ```ts
 * const result = await generateSpeech({ model: 'speech-model', text: 'Hello' })
 * await assetStore.put(result.audio) // optional, explicit persistence
 * ```
 */
export type GenerateSpeech<
  TModel = string,
  TVoice = string,
  TExtra = never,
  TRaw = unknown,
  TMetadata = unknown,
  TWarning = unknown,
> = <TSelectedModel extends TModel | AnyRoutable = TModel>(
  options: Omit<GenerateSpeechOptions<TModel, TVoice, TExtra>, "model"> &
    Readonly<{ model: TSelectedModel }> &
    RoutingCallOptions<TSelectedModel>,
) => Promise<GenerateSpeechResult<TRaw, TMetadata, TWarning>>;
