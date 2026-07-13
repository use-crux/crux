/**
 * Node.js bounded HTTPS audio downloader for transcription adapters.
 *
 * Downloads reject non-HTTPS URLs, private network resolutions, oversized or
 * invalid audio, unsafe redirects, and timeouts without persisting the result.
 * Universal and isolate bundles should use `@use-crux/core/transcription`.
 *
 * @example
 * ```ts
 * import { downloadAudio } from '@use-crux/core/transcription/node'
 *
 * const audio = await downloadAudio(new URL('https://example.com/audio.mp3'))
 * ```
 *
 * @module
 */
export { createSecureAudioDownloader, downloadAudio } from './downloader'
export type {
  AudioPinnedDispatcher,
  SecureAudioDownloadRequest,
  SecureAudioDownloaderOptions,
  SecureAudioFetch,
  SecureAudioFetchResponse,
} from './downloader'
