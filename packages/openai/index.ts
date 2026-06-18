/**
 * `@crux/openai` — OpenAI SDK adapter.
 *
 * Built from the single-turn provider runtime in `@crux/core/adapter`.
 * The public surface stays intentionally small: create a Crux adapter, access
 * the provider runtime/profile, use lightweight compaction helpers, convert
 * messages, or create embeddings.
 *
 * @example
 * ```ts
 * import { prompt } from '@crux/core'
 * import { createOpenAI } from '@crux/openai'
 * import OpenAI from 'openai'
 *
 * const openai = createOpenAI(new OpenAI({ apiKey: '...' }))
 * const result = await openai.generate(myPrompt, { model: 'gpt-4o' })
 * ```
 *
 * @module
 */

export { createOpenAI, openaiProviderRuntime } from './native'
export { createGenerateObjectFn, createGenerateTextFn } from './helpers'
export { embedding } from './embedding'
export { fromMessages, openAITranscript, toMessages } from './message-codec'
export type { OpenAIAssistantTurn } from './message-codec'
export type { OpenAIChatRequest, OpenAIEmbeddingConfig, OpenAIExtra } from './types'
