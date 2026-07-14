/**
 * Shared orchestration contracts consumed by every generation entry point.
 *
 * These types describe the adapter ↔ orchestrator boundary: the
 * {@link OrchestrationSpec} an adapter constructs from its prompt and options,
 * and the {@link TextDeltaExtractor} it provides so streaming progress can be
 * observed without the orchestrator knowing the SDK's chunk shape.
 *
 * @module
 * @internal
 */

import type { AnyPromptConfig } from '../prompt/prompt-types'
import type { MiddlewareResult } from '../runtime/types'
import type { ResolvedPrompt } from '../resolver/types'
import type { TimeoutOptions } from './timeout'

/**
 * Context for generate/stream orchestration. Adapters construct this
 * from their prompt + options and pass it to `orchestrateGenerate()`
 * or `orchestrateStream()`.
 */
export interface OrchestrationSpec<TPreparedArgs extends Record<string, unknown> = Record<string, unknown>> {
  /** The prompt ID (used for middleware args and hook args). */
  promptId: string | undefined
  /**
   * The prompt's config and hooks.
   *
   * Accepts the full `AnyPromptConfig` from any concrete prompt — the
   * orchestrator only reads `hooks`, and adapter generic
   * `TOutput` is erased by this boundary.
   */
  promptConfig: AnyPromptConfig
  /** SDK-specific prepared args (model, messages, settings, etc.). */
  preparedArgs: TPreparedArgs
  /** The model being used. */
  model: unknown
  /** Normalized model identity used only for internal observability. */
  traceModel?: string
  /** The input passed to generate(). */
  input: Record<string, unknown>
  /** Operation being orchestrated. Defaults to generate. */
  operation?: 'generate' | 'stream'
  /** Resolved prompt data, when available. */
  resolved?: ResolvedPrompt
  /** Provider identifier, when known. */
  provider?: string
  /** Output mode for cache hydration. */
  outputMode?: 'text' | 'object'
  /** Optional factory for cached stream replay. */
  createCachedStreamResult?: (cached: {
    text?: string
    object?: unknown
    meta?: Record<string, unknown>
  }) => MiddlewareResult
  /** Structured timeout budgets for this managed operation. */
  timeout?: TimeoutOptions
}

/**
 * Callback that extracts a text delta string from an SDK-specific stream chunk.
 * Each adapter provides its own extractor since chunk formats differ by SDK.
 *
 * @example
 * ```ts
 * // OpenAI
 * const extract: TextDeltaExtractor = (chunk) =>
 *   chunk?.choices?.[0]?.delta?.content
 *
 * // Anthropic
 * const extract: TextDeltaExtractor = (chunk) =>
 *   chunk?.type === 'content_block_delta' ? chunk.delta?.text : undefined
 * ```
 */
export type TextDeltaExtractor = (chunk: unknown) => string | undefined
