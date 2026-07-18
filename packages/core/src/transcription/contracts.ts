import type { MediaSource } from "../types/content";
import type { BoundaryDef } from "../safety/boundary";
import type {
  CompletedOperationResult,
  OperationTimeout,
} from "../completed-operation/contracts";
import type {
  CompletedOperationModelGuard,
  RoutingCallOptions,
} from "../routing/types";
import type { Constraint } from "../safety/constraint/types";
import type { Guardrail } from "../safety/guardrail/types";
import type { SafetyTuneOptions } from "../safety/tune";

/** Audio accepted by flat transcription operations without storage access. */
export type AudioSource = MediaSource;

/** One measured transcript interval in seconds. Unknown timing stays absent. */
export interface TranscriptInterval {
  readonly text: string;
  readonly startSecond: number;
  readonly endSecond: number;
  readonly speaker?: string;
}

/** Portable controls shared by transcription adapters. */
export interface TranscribeCommonOptions {
  readonly audio: AudioSource;
  /** Source-language hint. Detected language is returned separately. */
  readonly language?: string;
  /** Transcribe in-place or translate into one explicit target language. */
  readonly task?:
    | "transcribe"
    | Readonly<{ type: "translate"; targetLanguage: string }>;
  /** Requested measured detail. Unsupported detail fails before provider I/O. */
  readonly timestamps?: "none" | "segment" | "word" | "segment-and-word";
  readonly diarization?: boolean;
  readonly prompt?: string;
  /**
   * Canonical input and transcript policies applied around the provider call.
   *
   * Input-media callbacks receive the original audio source with an operation
   * origin; narrow `part.type` and `origin.kind` before reading their fields.
   * The stable audio index is always `0`. Enforced strip blocks because audio
   * is required, while report mode records intent and preserves it. Output-text
   * callbacks receive the validated top-level transcript string. Provider raw,
   * metadata, and warnings remain unguarded and may repeat blocked content.
   */
  readonly guardrails?: readonly Guardrail[];
  /**
   * Terminal requirements evaluated once against guarded transcript text.
   *
   * Assert failures throw and suggest failures remain in `result.safety`.
   * Transcription never retries the provider to repair a failed constraint.
   */
  readonly constraints?: readonly Constraint<
    BoundaryDef<"model.output.text", string>
  >[];
  /** Per-call posture and tuning for attached Safety policies. */
  readonly safety?: SafetyTuneOptions;
  readonly abortSignal?: AbortSignal;
  readonly timeout?: OperationTimeout;
}

/** Options accepted by a flat provider transcription function. */
export type TranscribeOptions<
  TModel = string,
  TExtra = never,
> = TranscribeCommonOptions &
  Readonly<{
    model: TModel;
    /** Provider-native controls with no portable Crux equivalent. */
    extra?: TExtra;
  }>;

/**
 * Provider-neutral result of one transcription operation.
 *
 * Segment and word arrays always exist. Providers must leave unavailable
 * timing or speaker facts empty rather than estimating them. An enforced
 * transcript rewrite clears both arrays so stale text cannot survive there.
 * Provider-native `raw`, metadata, and warnings are preserved but unguarded.
 */
export type TranscriptionResult<
  TRaw = unknown,
  TMetadata = unknown,
  TWarning = unknown,
> = CompletedOperationResult<TRaw, TMetadata, TWarning> &
  Readonly<{
    text: string;
    segments: readonly TranscriptInterval[];
    words: readonly TranscriptInterval[];
    language?: string;
    durationInSeconds?: number;
  }>;

/**
 * Flat stateless transcription function. Provider errors propagate unchanged.
 *
 * @example
 * ```ts
 * const result = await transcribe({ model: 'audio-model', audio: recording })
 * console.log(result.text)
 * ```
 */
export type Transcribe<
  TModel = string,
  TExtra = never,
  TRaw = unknown,
  TMetadata = unknown,
  TWarning = unknown,
> = ((
  options: TranscribeOptions<TModel, TExtra>,
) => Promise<TranscriptionResult<TRaw, TMetadata, TWarning>>) &
  (<TSelectedModel>(
    options: Omit<TranscribeOptions<TModel, TExtra>, "model"> &
      Readonly<{ model: TSelectedModel }> &
      CompletedOperationModelGuard<TModel, TSelectedModel> &
      RoutingCallOptions<TSelectedModel>,
  ) => Promise<TranscriptionResult<TRaw, TMetadata, TWarning>>);
