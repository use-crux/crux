import type { Experimental_TranscriptionResult as AiSdkTranscriptionResult, TranscriptionModel } from 'ai'
import {
  createUnsupportedCapabilityError,
  normalizeAudioSource,
  validateTranscriptionResult,
  type Transcribe,
} from '@use-crux/core'
import { downloadAudio } from '@use-crux/core/transcription/node'
import type { SdkGateway } from './gateway'

type NativeArgs = Parameters<SdkGateway['transcribe']>[0]

/** AI SDK-native transcription controls forwarded unchanged. */
export interface AITranscriptionExtra extends Record<string, unknown> {
  readonly providerOptions?: NativeArgs['providerOptions']
  readonly maxRetries?: NativeArgs['maxRetries']
  readonly headers?: NativeArgs['headers']
}

/** Provider metadata retained from the AI SDK transcription result. */
export interface AITranscriptionMetadata {
  readonly responses: AiSdkTranscriptionResult['responses']
  readonly providerMetadata: AiSdkTranscriptionResult['providerMetadata']
}

/** Stateless transcription exposed by a bound AI SDK gateway. */
export type AITranscribe = Transcribe<
  TranscriptionModel,
  AITranscriptionExtra,
  AiSdkTranscriptionResult,
  AITranscriptionMetadata,
  AiSdkTranscriptionResult['warnings'][number]
>

/** Bind one native AI SDK transcription operation to an injectable gateway. */
export function createAiSdkTranscribe(gateway: SdkGateway): AITranscribe {
  return async (options) => {
    const issue = options.language !== undefined
      ? { capability: 'transcription.language', path: 'language', remediation: 'Pass provider-specific language controls in extra.providerOptions only when supported.' }
      : options.prompt !== undefined
        ? { capability: 'transcription.prompt', path: 'prompt', remediation: 'Pass provider-specific prompt controls in extra.providerOptions only when supported.' }
        : undefined
    if (issue) {
      throw createUnsupportedCapabilityError({
        adapter: 'ai-sdk',
        model: modelId(options.model),
        issues: [issue],
      })
    }
    const normalized = await normalizeAudioSource(options.audio)
    if (normalized.type === 'provider-file') {
      throw createUnsupportedCapabilityError({
        adapter: 'ai-sdk',
        model: modelId(options.model),
        issues: [{
          capability: 'transcription.provider-file', path: 'audio', mediaType: normalized.mediaType,
          remediation: 'Hydrate the provider file to bytes before transcription.',
        }],
      })
    }
    const raw = await gateway.transcribe({
      model: options.model,
      audio: normalized.type === 'url' ? normalized.url : await dataBytes(normalized.data),
      ...(normalized.type === 'url' ? { download: secureDownload } : {}),
      ...(options.abortSignal === undefined ? {} : { abortSignal: options.abortSignal }),
      ...(options.extra?.providerOptions === undefined ? {} : { providerOptions: options.extra.providerOptions }),
      ...(options.extra?.maxRetries === undefined ? {} : { maxRetries: options.extra.maxRetries }),
      ...(options.extra?.headers === undefined ? {} : { headers: options.extra.headers }),
    })
    return validateTranscriptionResult({
      text: raw.text,
      segments: raw.segments.map((segment) => ({
        text: segment.text,
        start: segment.startSecond,
        end: segment.endSecond,
      })),
      ...(raw.language === undefined ? {} : { language: raw.language }),
      ...(raw.durationInSeconds === undefined ? {} : { durationInSeconds: raw.durationInSeconds }),
      warnings: raw.warnings,
      metadata: { responses: raw.responses, providerMetadata: raw.providerMetadata },
    }, raw)
  }
}

async function secureDownload(input: { url: URL; abortSignal?: AbortSignal }) {
  const asset = await downloadAudio(input.url, { signal: input.abortSignal })
  return { data: asset.data as Uint8Array, mediaType: asset.mediaType }
}

async function dataBytes(data: Uint8Array | Blob): Promise<Uint8Array> {
  return data instanceof Uint8Array ? data : new Uint8Array(await data.arrayBuffer())
}

function modelId(model: TranscriptionModel): string {
  return typeof model === 'string' ? model : `${model.provider}/${model.modelId}`
}
