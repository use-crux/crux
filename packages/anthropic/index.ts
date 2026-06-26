/**
 * `@use-crux/anthropic` — Anthropic SDK adapter.
 *
 * Built from the single-turn provider runtime in `@use-crux/core/adapter`.
 * Anthropic-specific request params, message/tool-result blocks, cache-control
 * system blocks, and response normalization stay owned by this package.
 *
 * @example
 * ```ts
 * import { createAnthropic } from '@use-crux/anthropic'
 * import Anthropic from '@anthropic-ai/sdk'
 *
 * const anthropic = createAnthropic(new Anthropic({ apiKey: '...' }))
 * const result = await anthropic.generate(myPrompt, {
 *   model: 'claude-sonnet-4-5-20250929',
 * })
 * ```
 *
 * @module
 */

// This package intentionally stays generation-only. Anthropic's direct SDK
// adapter does not expose a Crux embedding helper; pair it with `embedding()`
// from @use-crux/ai or another embedding provider for retrieval/indexing.

export { createAnthropic, anthropicProviderRuntime } from './native'
export { createGenerateObjectFn, createGenerateTextFn } from './helpers'
export { anthropicTranscript, fromMessages, toMessages } from './message-codec'
export type { AnthropicAssistantTurn } from './message-codec'
export type { AnthropicExtra, AnthropicRequest } from './types'
