/**
 * `@use-crux/google` — Google GenAI SDK adapter.
 *
 * Built from the single-turn provider bundle in `@use-crux/core/adapter`.
 * Google-specific request params, function-call/function-response parts, and
 * CachedContent lifecycle remain owned by this package.
 *
 * @module
 */

export { createGoogle, googleProviderRuntime } from "./native";
export { googleModelCapacity } from "./capacity";
export { fromResponse, googleCodecCachedContent, toParams } from "./codec";
export type { GoogleCodecOptions } from "./codec";
export type {
  CreateGoogleOptions,
  GoogleRerankerConfig,
  GoogleRetrievalModelConfig,
} from "./native";
export type {
  GoogleGeminiImageExtra,
  GoogleGenerateImage,
  GoogleImageExtra,
  GoogleImagenEditExtra,
  GoogleImagenImageExtra,
} from "./image-generation";
export type {
  GoogleImageStreamMetadata,
  GoogleStreamImage,
  GoogleStreamImageResult,
} from "./image-streaming";
export type {
  GoogleTranscribe,
  GoogleTranscriptionExtra,
  GoogleTranscriptionMetadata,
} from "./transcription";
export type {
  GoogleGenerateSpeech,
  GoogleSpeechExtra,
  GoogleSpeechVoice,
} from "./speech";
export type {
  GoogleStreamSpeech,
  GoogleStreamSpeechResult,
} from "./speech-streaming";
export { createGenerateObjectFn, createGenerateTextFn } from "./helpers";
export { embedding } from "./embedding";
export { fromMessages, googleTranscript, toMessages } from "./message-codec";
export type { GoogleAssistantTurn } from "./message-codec";
export type {
  GoogleCacheConfig,
  GoogleCachedContentCachePort,
  GoogleCachedContentCallOptions,
  GoogleCachedContentErrorMode,
  GoogleCachedContentLifecycle,
  GoogleCachedContentOption,
  GoogleCachedContentPlan,
  GoogleCachedContentPrepareArgs,
  GoogleCacheName,
} from "./cached-content";
export type {
  GoogleEmbeddingConfig,
  GoogleExtra,
  GoogleFunctionDeclaration,
  GoogleRequest,
} from "./types";
