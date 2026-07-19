import type { DataAsset } from "../asset/types";
import type {
  CompletedOperationPayload,
  OperationTimeout,
} from "../completed-operation/contracts";
import type {
  CompletedOperationModelGuard,
  RoutingCallOptions,
} from "../routing/types";
import type { Guardrail } from "../safety/guardrail/types";
import type { SafetyTuneOptions } from "../safety/tune";
import type { WithOperationResultMeta } from "../observability/result-meta";

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
  /**
   * Guardrails applied to canonical speech text, instructions, and generated audio.
   *
   * Output-media callbacks receive the generated audio as
   * `subject.part.source`. Enforced `strip` blocks because speech audio is
   * required; report mode records intent without changing the result.
   * Provider-native `raw`, metadata, and warnings are not guarded.
   */
  guardrails?: readonly Guardrail[];
  /** Per-policy enablement and enforcement posture for attached guardrails. */
  safety?: SafetyTuneOptions;
  /** Provider-native controls with no portable Crux equivalent. */
  extra?: TExtra;
}>;

/** Provider-authored speech facts before Core adds operation correlation. */
export type GenerateSpeechPayload<
  TRaw = unknown,
  TMetadata = unknown,
  TWarning = unknown,
> = CompletedOperationPayload<TRaw, TMetadata, TWarning> &
  Readonly<{ audio: DataAsset }>;

/** Public speech result with usable audio and its exact media span pair. */
export type GenerateSpeechResult<
  TRaw = unknown,
  TMetadata = unknown,
  TWarning = unknown,
> = WithOperationResultMeta<
  GenerateSpeechPayload<TRaw, TMetadata, TWarning>
>;

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
> = ((
  options: GenerateSpeechOptions<TModel, TVoice, TExtra>,
) => Promise<GenerateSpeechResult<TRaw, TMetadata, TWarning>>) &
  (<TSelectedModel>(
    options: Omit<GenerateSpeechOptions<TModel, TVoice, TExtra>, "model"> &
      Readonly<{ model: TSelectedModel }> &
      CompletedOperationModelGuard<TModel, TSelectedModel> &
      RoutingCallOptions<TSelectedModel>,
  ) => Promise<GenerateSpeechResult<TRaw, TMetadata, TWarning>>);
