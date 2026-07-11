/** Provider-neutral flat transcription contracts and secure audio utilities. @module */
export type {
  AudioSource,
  Transcribe,
  TranscribeCommonOptions,
  TranscribeOptions,
  TranscriptionResult,
  TranscriptionSegment,
} from './contracts'
export { createNoTranscriptError, isNoTranscriptError } from './errors'
export type { NoTranscriptError } from './errors'
export { normalizeAudioSource } from './source'
export { assertAudioMediaType, detectAudioMediaType, validateAudioBytes } from './audio-validation'
export { validateTranscriptionResult } from './result-validation'
export type { NativeTranscriptionResult } from './result-validation'
export { createSecureAudioDownloader, downloadAudio } from './downloader'
export type {
  AudioPinnedDispatcher,
  SecureAudioDownloadRequest,
  SecureAudioDownloaderOptions,
  SecureAudioFetch,
  SecureAudioFetchResponse,
} from './downloader'
