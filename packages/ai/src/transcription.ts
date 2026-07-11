import type { Experimental_TranscriptionResult as AiSdkTranscriptionResult, TranscriptionModel } from 'ai'
import {
  createUnsupportedCapabilityError,
  normalizeAudioSource,
  validateTranscribeOptions,
  validateTranscriptionResult,
  type Transcribe,
} from '@use-crux/core'
import { bindCompletedOperation, defineCompletedOperation } from '@use-crux/core/adapter'
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
  const definition = defineCompletedOperation({
    async normalize(options: Parameters<AITranscribe>[0]) {
      validateTranscribeOptions(options)
      const issue =
        options.language !== undefined
          ? {
              capability: 'transcription.language',
              path: 'language',
              remediation: 'Pass provider-specific language controls in extra.providerOptions only when supported.',
            }
          : options.prompt !== undefined
            ? {
                capability: 'transcription.prompt',
                path: 'prompt',
                remediation: 'Pass provider-specific prompt controls in extra.providerOptions only when supported.',
              }
            : undefined
      if (issue) {
        throw createUnsupportedCapabilityError({
          adapter: 'ai-sdk',
          model: modelId(options.model),
          issues: [issue],
        })
      }
      const audio = await normalizeAudioSource(options.audio)
      if (audio.type === 'provider-file') {
        throw createUnsupportedCapabilityError({
          adapter: 'ai-sdk',
          model: modelId(options.model),
          issues: [
            {
              capability: 'transcription.provider-file',
              path: 'audio',
              mediaType: audio.mediaType,
              remediation: 'Hydrate the provider file to bytes before transcription.',
            },
          ],
        })
      }
      return { options, audio }
    },
    support: () => 'unknown' as const,
    async invoke({ options, audio }, { signal }) {
      return gateway.transcribe({
        model: options.model,
        audio: audio.type === 'url' ? audio.url : await dataBytes(audio.data),
        ...(audio.type === 'url' ? { download: secureDownload } : {}),
        abortSignal: signal,
        ...(options.extra?.providerOptions === undefined ? {} : { providerOptions: options.extra.providerOptions }),
        ...(options.extra?.maxRetries === undefined ? {} : { maxRetries: options.extra.maxRetries }),
        ...(options.extra?.headers === undefined ? {} : { headers: options.extra.headers }),
      })
    },
    validate(raw) {
      return validateTranscriptionResult(
        {
          text: raw.text,
          segments: raw.segments.map((segment) => ({
            text: segment.text,
            startSecond: segment.startSecond,
            endSecond: segment.endSecond,
          })),
          words: [],
          ...(raw.language === undefined ? {} : { language: raw.language }),
          ...(raw.durationInSeconds === undefined ? {} : { durationInSeconds: raw.durationInSeconds }),
          warnings: raw.warnings,
          providerMetadata: {
            responses: raw.responses,
            providerMetadata: raw.providerMetadata,
          },
          execution: { kind: 'native', calls: 1 },
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
    provider: 'ai-sdk',
    operation: 'transcribe',
  })
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
