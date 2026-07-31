/**
 * `@use-crux/openai` — OpenAI SDK adapter.
 *
 * Built from the single-turn provider bundle in `@use-crux/core/adapter`.
 * The public surface stays intentionally small: create a Crux adapter, access
 * the provider runtime/profile, use lightweight compaction helpers, convert
 * messages, or create embeddings.
 *
 * @example
 * ```ts
 * import { prompt } from '@use-crux/core'
 * import { createOpenAI } from '@use-crux/openai'
 * import OpenAI from 'openai'
 *
 * const openai = createOpenAI(new OpenAI({ apiKey: '...' }))
 * const result = await openai.generate(myPrompt, { model: 'gpt-4o' })
 * ```
 *
 * @module
 */

export { createOpenAI, openaiProviderRuntime } from "./native";
export { openAIModelCapacity } from "./capacity";
export { fromResponse, toParams } from "./codec";
export type { OpenAICodecOptions } from "./codec";
export type {
  OpenAIRerankerConfig,
  OpenAIRetrievalModelConfig,
} from "./native";
export type { OpenAIGenerateImage, OpenAIImageExtra } from "./image-generation";
export type {
  OpenAIImageStreamExtra,
  OpenAIImageStreamMetadata,
  OpenAIStreamImage,
  OpenAIStreamImageResult,
} from "./image-streaming";
export type {
  OpenAITranscribe,
  OpenAITranscriptionExtra,
  OpenAITranscriptionMetadata,
  OpenAITranslationExtra,
} from "./transcription";
export type {
  OpenAIGenerateSpeech,
  OpenAISpeechExtra,
  OpenAISpeechVoice,
} from "./speech";
export type {
  OpenAISpeechStreamExtra,
  OpenAIStreamSpeech,
  OpenAIStreamSpeechResult,
} from "./speech-streaming";
export { createGenerateObjectFn, createGenerateTextFn } from "./helpers";
export { embedding } from "./embedding";
export { fromMessages, openAITranscript, toMessages } from "./message-codec";
export type { OpenAIAssistantTurn } from "./message-codec";
export type {
  OpenAIChatRequest,
  OpenAIEmbeddingConfig,
  OpenAIExtra,
} from "./types";
