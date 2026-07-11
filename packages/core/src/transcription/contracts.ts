import type { MediaSource } from "../types/content";
import type {
  CompletedOperationResult,
  OperationTimeout,
} from "../completed-operation/contracts";
import type { AnyRoutable, RoutingCallOptions } from "../routing/types";

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
 * timing or speaker facts empty rather than estimating them.
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
> = <TSelectedModel extends TModel | AnyRoutable = TModel>(
  options: Omit<TranscribeOptions<TModel, TExtra>, "model"> &
    Readonly<{ model: TSelectedModel }> &
    RoutingCallOptions<TSelectedModel>,
) => Promise<TranscriptionResult<TRaw, TMetadata, TWarning>>;
