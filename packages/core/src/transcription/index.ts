/**
 * Provider-neutral flat transcription contracts, normalization, and validation.
 *
 * This universal entrypoint does not import Node.js built-ins. Node applications
 * and adapters can import the bounded HTTPS downloader from
 * `@use-crux/core/transcription/node`.
 *
 * @module
 */
export type {
  AudioSource,
  Transcribe,
  TranscribeCommonOptions,
  TranscribeOptions,
  TranscriptionResult,
  TranscriptInterval,
} from './contracts'
export { createNoTranscriptError, isNoTranscriptError } from './errors'
export type { NoTranscriptError } from './errors'
export { normalizeAudioSource } from './source'
export { assertAudioMediaType, detectAudioMediaType, validateAudioBytes } from './audio-validation'
export { validateTranscriptionResult } from './result-validation'
export { validateTranscribeOptions } from './result-validation'
export type { NativeTranscriptionResult } from './result-validation'
