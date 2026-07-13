import type { AssetRef } from '../src/asset'
import type { AudioSource, Transcribe, TranscribeOptions } from '../src/transcription'

declare const ref: AssetRef
declare const transcribe: Transcribe<'audio-model'>

void transcribe({ model: 'audio-model', audio: new Uint8Array([1]) })

const options = {
  model: 'audio-model',
  audio: new URL('https://example.com/audio.wav'),
  language: 'en',
} satisfies TranscribeOptions<'audio-model'>
void options

// @ts-expect-error AssetRef is persistence state, not audio input.
const invalidSource: AudioSource = ref
void invalidSource

const invalidOptions = {
  model: 'audio-model',
  audio: new Uint8Array([1]),
  // @ts-expect-error transcription has no hidden storage port.
  store: {},
} satisfies TranscribeOptions<'audio-model'>
void invalidOptions
