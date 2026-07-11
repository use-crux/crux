import { toFile, type Uploadable } from 'openai'
import type OpenAI from 'openai'
import type {
  TranscriptionCreateParamsNonStreaming,
  TranscriptionCreateResponse,
} from 'openai/resources/audio/transcriptions'
import {
  createUnsupportedCapabilityError,
  downloadAudio,
  normalizeAudioSource,
  validateTranscriptionResult,
  type DataAsset,
  type Transcribe,
} from '@use-crux/core'

type NativeControls = Omit<
  TranscriptionCreateParamsNonStreaming,
  'file' | 'model' | 'language' | 'prompt' | 'response_format' | 'stream'
>

/** OpenAI-native non-streaming transcription controls. */
export type OpenAITranscriptionExtra = NativeControls & {
  readonly response_format?: 'json' | 'verbose_json' | 'diarized_json'
}

/** Safe OpenAI transcription metadata projected from the native response. */
export interface OpenAITranscriptionMetadata {
  readonly usage?: TranscriptionCreateResponse['usage']
}

/** Flat transcription operation attached to a bound OpenAI adapter. */
export type OpenAITranscribe = Transcribe<
  string,
  OpenAITranscriptionExtra,
  TranscriptionCreateResponse,
  OpenAITranscriptionMetadata
>

/** Build one stateless OpenAI audio transcription operation. */
export function createOpenAITranscribe(client: OpenAI): OpenAITranscribe {
  return async (options) => {
    const normalized = await normalizeAudioSource(options.audio)
    if (normalized.type === 'provider-file') {
      throw createUnsupportedCapabilityError({
        adapter: 'openai',
        model: options.model,
        issues: [{
          capability: 'transcription.provider-file',
          path: 'audio',
          mediaType: normalized.mediaType,
          remediation: 'Pass audio bytes, a Blob, data URL, or an HTTPS URL.',
        }],
      })
    }
    const audio = normalized.type === 'url'
      ? await downloadAudio(normalized.url, { signal: options.abortSignal })
      : normalized
    const responseFormat = options.extra?.response_format ?? defaultResponseFormat(options.model)
    const raw = await client.audio.transcriptions.create({
      ...options.extra,
      file: await uploadable(audio),
      model: options.model,
      response_format: responseFormat,
      ...(options.language === undefined ? {} : { language: options.language }),
      ...(options.prompt === undefined ? {} : { prompt: options.prompt }),
      stream: false,
    } as TranscriptionCreateParamsNonStreaming, options.abortSignal ? { signal: options.abortSignal } : undefined) as TranscriptionCreateResponse

    const segments = 'segments' in raw && Array.isArray(raw.segments)
      ? raw.segments.map((segment) => ({ text: segment.text, start: segment.start, end: segment.end }))
      : []
    const warnings = segments.length === 0 ? ['OpenAI transcription response omitted timestamp segments.'] : undefined
    const language = 'language' in raw && typeof raw.language === 'string' ? raw.language : undefined
    const durationInSeconds = 'duration' in raw && typeof raw.duration === 'number'
      ? raw.duration
      : durationUsage(raw.usage)

    return validateTranscriptionResult({
      text: raw.text,
      segments,
      ...(language === undefined ? {} : { language }),
      ...(durationInSeconds === undefined ? {} : { durationInSeconds }),
      ...(warnings === undefined ? {} : { warnings }),
      ...(raw.usage === undefined ? {} : { metadata: { usage: raw.usage } }),
    }, raw)
  }
}

async function uploadable(asset: DataAsset): Promise<Uploadable> {
  return toFile(asset.data, asset.filename ?? `audio.${extensionFor(asset.mediaType)}`, { type: asset.mediaType })
}

function defaultResponseFormat(model: string): 'json' | 'verbose_json' | 'diarized_json' {
  if (model.includes('diarize')) return 'diarized_json'
  return model === 'whisper-1' ? 'verbose_json' : 'json'
}

function durationUsage(usage: TranscriptionCreateResponse['usage']): number | undefined {
  return usage && 'seconds' in usage && typeof usage.seconds === 'number' ? usage.seconds : undefined
}

function extensionFor(mediaType: string): string {
  if (mediaType.includes('wav')) return 'wav'
  if (mediaType.includes('flac')) return 'flac'
  if (mediaType.includes('ogg')) return 'ogg'
  if (mediaType.includes('webm')) return 'webm'
  if (mediaType.includes('mp4') || mediaType.includes('m4a')) return 'm4a'
  return 'mp3'
}
