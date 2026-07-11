import type { Asset } from '../asset/types'

/** Audio accepted by flat transcription operations without storage access. */
export type AudioSource = Asset | string | URL | Uint8Array | ArrayBuffer | Blob

/** One ordered transcript interval measured in seconds. */
export interface TranscriptionSegment {
  readonly text: string
  readonly start: number
  readonly end: number
}

/** Portable controls shared by transcription adapters. */
export interface TranscribeCommonOptions {
  readonly audio: AudioSource
  readonly language?: string
  readonly prompt?: string
  readonly abortSignal?: AbortSignal
}

/** Options accepted by a flat provider transcription function. */
export type TranscribeOptions<TModel = string, TExtra extends Record<string, unknown> = Record<string, never>> =
  TranscribeCommonOptions & {
    readonly model: TModel
    /** Provider-native controls with no portable Crux equivalent. */
    readonly extra?: TExtra
  }

/** Provider-neutral result of exactly one transcription operation. */
export interface TranscriptionResult<TRaw = unknown, TMetadata = unknown, TWarning = string> {
  readonly text: string
  readonly segments: readonly TranscriptionSegment[]
  readonly language?: string
  readonly durationInSeconds?: number
  readonly warnings?: readonly TWarning[]
  readonly metadata?: TMetadata
  /** Unmodified native operation result. */
  readonly raw: TRaw
}

/** Flat stateless transcription function. */
export type Transcribe<
  TModel = string,
  TExtra extends Record<string, unknown> = Record<string, never>,
  TRaw = unknown,
  TMetadata = unknown,
  TWarning = string,
> = (options: TranscribeOptions<TModel, TExtra>) => Promise<TranscriptionResult<TRaw, TMetadata, TWarning>>
