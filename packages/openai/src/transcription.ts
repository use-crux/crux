import { toFile, type Uploadable } from 'openai'
import type OpenAI from 'openai'
import type {
  TranscriptionCreateParamsNonStreaming,
  TranscriptionCreateResponse,
} from 'openai/resources/audio/transcriptions'
import {
  createUnsupportedCapabilityError,
  normalizeAudioSource,
  validateTranscribeOptions,
  validateTranscriptionResult,
  type DataAsset,
  type Transcribe,
} from '@use-crux/core'
import { bindCompletedOperation, defineCompletedOperation } from '@use-crux/core/adapter'
import { downloadAudio } from '@use-crux/core/transcription/node'

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
  const definition = defineCompletedOperation({
    async normalize(options: Parameters<OpenAITranscribe>[0]) {
      validateTranscribeOptions(options)
      const audio = await normalizeAudioSource(options.audio)
      if (audio.type === 'provider-file') {
        throw createUnsupportedCapabilityError({
          adapter: 'openai',
          model: options.model,
          issues: [
            {
              capability: 'transcription.provider-file',
              path: 'audio',
              mediaType: audio.mediaType,
              remediation: 'Pass audio bytes, a Blob, data URL, or an HTTPS URL.',
            },
          ],
        })
      }
      return { options, audio }
    },
    support: () => 'supported' as const,
    async invoke({ options, audio }, { signal }) {
      const materialized = audio.type === 'url' ? await downloadAudio(audio.url, { signal }) : audio
      const responseFormat = options.extra?.response_format ?? defaultResponseFormat(options.model)
      return client.audio.transcriptions.create(
        {
          ...options.extra,
          file: await uploadable(materialized),
          model: options.model,
          response_format: responseFormat,
          ...(options.language === undefined ? {} : { language: options.language }),
          ...(options.prompt === undefined ? {} : { prompt: options.prompt }),
          stream: false,
        } as TranscriptionCreateParamsNonStreaming,
        { signal },
      ) as Promise<TranscriptionCreateResponse>
    },
    validate(raw) {
      const segments =
        'segments' in raw && Array.isArray(raw.segments)
          ? raw.segments.map((segment) => ({
              text: segment.text,
              startSecond: segment.start,
              endSecond: segment.end,
            }))
          : []
      const warnings = segments.length === 0 ? ['OpenAI transcription response omitted timestamp segments.'] : []
      const language = 'language' in raw && typeof raw.language === 'string' ? raw.language : undefined
      const durationInSeconds =
        'duration' in raw && typeof raw.duration === 'number' ? raw.duration : durationUsage(raw.usage)
      return validateTranscriptionResult(
        {
          text: raw.text,
          segments,
          words: [],
          warnings,
          execution: { kind: 'native', calls: 1 },
          ...(language === undefined ? {} : { language }),
          ...(durationInSeconds === undefined ? {} : { durationInSeconds }),
          ...(raw.usage === undefined ? {} : { providerMetadata: { usage: raw.usage } }),
        },
        raw,
      )
    },
    report: (result) => ({
      kind: 'audio',
      segments: result.segments.length,
      words: result.words.length,
    }),
    conformance: [],
  })
  return bindCompletedOperation({
    definition,
    provider: 'openai',
    operation: 'transcribe',
  })
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
