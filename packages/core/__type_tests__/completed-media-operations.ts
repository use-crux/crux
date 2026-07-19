import { fallback } from '@use-crux/core'
import { cascade, retry, router, split } from '@use-crux/core/routing'
import type {
  Asset,
  AssetStore,
  CompletedOperationResult,
  GenerateImage,
  GenerateImageOptions,
  GenerateImageResult,
  GenerateSpeech,
  GenerateSpeechOptions,
  GenerateSpeechResult,
  TranscriptInterval,
  TranscribeOptions,
  TranscriptionResult,
} from '@use-crux/core'
import type {
  CompletedOperationPayload,
  GenerateImagePayload,
  GenerateSpeechPayload,
  TranscriptionPayload,
} from '@use-crux/core/adapter'

declare const image: Asset
declare const store: AssetStore
declare const generateImage: GenerateImage<'image-model'>
declare const generateSpeech: GenerateSpeech<'speech-model', 'alloy' | 'nova'>

void generateImage({ model: 'image-model', prompt: 'A quiet canal', size: '1024x1024' })
void generateImage({
  model: 'image-model',
  prompt: { text: 'Edit this', images: [image], mask: image },
  aspectRatio: '16:9',
  timeout: { totalMs: 30_000, stepMs: 10_000 },
})

const invalidMask = {
  model: 'image-model',
  // @ts-expect-error a mask requires at least one reference image
  prompt: { text: 'Edit this', mask: image },
} satisfies GenerateImageOptions<'image-model'>
void invalidMask

const conflictingDimensions = {
  model: 'image-model',
  prompt: 'A quiet canal',
  size: '1024x1024',
  // @ts-expect-error size and aspectRatio are mutually exclusive
  aspectRatio: '1:1',
} satisfies GenerateImageOptions<'image-model'>
void conflictingDimensions

const imageStore = {
  model: 'image-model',
  prompt: 'A quiet canal',
  // @ts-expect-error completed operations never accept persistence
  store,
} satisfies GenerateImageOptions<'image-model'>
void imageStore

const imageCache = {
  model: 'image-model',
  prompt: 'A quiet canal',
  // @ts-expect-error completed operations have no response-cache option
  cache: true,
} satisfies GenerateImageOptions<'image-model'>
void imageCache

void generateSpeech({ model: 'speech-model', text: 'Hello world', voice: 'alloy' })

const resilientImage = fallback([
  retry('image-model', { attempts: 2 }),
  'image-model',
])
void generateImage({ model: resilientImage, prompt: 'A quiet canal' })
void generateImage({
  model: router({
    classify: () => 'fast' as const,
    routes: { fast: 'image-model', default: 'image-model' },
  }),
  prompt: 'A quiet canal',
})
void generateImage({
  model: split({
    seed: () => 'stable',
    routes: { only: { model: 'image-model', weight: 1 } },
  }),
  prompt: 'A quiet canal',
})

// @ts-expect-error completed operations reject incompatible raw model leaves
void generateImage({ model: 42, prompt: 'A quiet canal' })
// @ts-expect-error every routed leaf must belong to the adapter model type
void generateImage({ model: fallback(['image-model', 42]), prompt: 'A quiet canal' })
// @ts-expect-error deferred result evaluation belongs to generate/stream, not completed operations
void generateImage({
  model: cascade({ tiers: [{ model: 'image-model' }] }),
  prompt: 'A quiet canal',
})

const badVoice = {
  model: 'speech-model',
  text: 'Hello world',
  // @ts-expect-error adapters preserve their concrete voice type
  voice: 'echo',
} satisfies GenerateSpeechOptions<'speech-model', 'alloy' | 'nova'>
void badVoice

const interval = {
  text: 'hello',
  startSecond: 0,
  endSecond: 0.5,
  speaker: 'speaker-1',
} satisfies TranscriptInterval
void interval

const transcription = {
  model: 'audio-model',
  audio: new Uint8Array([1]),
  task: { type: 'translate', targetLanguage: 'en' },
  timestamps: 'segment-and-word',
  diarization: true,
  timeout: { totalMs: 60_000, stepMs: 30_000 },
} satisfies TranscribeOptions<'audio-model'>
void transcription

declare const tail: CompletedOperationResult
declare const payload: CompletedOperationPayload
declare const imagePayload: GenerateImagePayload
declare const transcriptionPayload: TranscriptionPayload
declare const speechPayload: GenerateSpeechPayload
declare const imageResult: GenerateImageResult
declare const transcriptionResult: TranscriptionResult
declare const speechResult: GenerateSpeechResult

void payload.warnings
void imagePayload.image
void transcriptionPayload.words
void speechPayload.audio

// @ts-expect-error provider-authored payloads never contain core-owned identity
void payload._meta
// @ts-expect-error operation-specific provider payloads remain unobserved
void imagePayload._meta

void tail.warnings
void tail.execution
void tail.raw
void tail._meta.traceId
void tail._meta.spanId
void imageResult.image
void imageResult._meta.traceId
void transcriptionResult.words
void transcriptionResult._meta.spanId
void speechResult.audio
void speechResult._meta.traceId

// @ts-expect-error obsolete specialized results do not expose metadata
void transcriptionResult.metadata
// @ts-expect-error obsolete specialized results do not expose response
void imageResult.response
// @ts-expect-error specialized results do not invent portable usage
void imageResult.usage
// @ts-expect-error warnings are always present
const missingWarnings: GenerateSpeechResult = { audio: {} as never, execution: { kind: 'native', calls: 1 }, raw: null }
void missingWarnings

const obsoletePromptBudget = {
  model: 'image-model',
  prompt: 'A quiet canal',
  // @ts-expect-error image operations have only total/step timeout budgets
  tokenBudget: 100,
} satisfies GenerateImageOptions<'image-model'>
void obsoletePromptBudget
