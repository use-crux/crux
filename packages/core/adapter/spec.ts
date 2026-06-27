/**
 * `AdapterSpec` — the lower-level execution IR for single-turn adapters.
 *
 * Provider packages should normally author `defineSingleTurnProviderBundle()`.
 * Core compiles that public bundle through the single-turn provider runtime
 * into this IR for execution tests and internal adapter plumbing.
 *
 * @module
 */

import type { z } from 'zod'
import type { GenerationSettings } from '../types'
import type { Message } from '../generation/messages'
import type { AdapterResponse, CallArgs, StreamHandle, ToolResultEntry } from './types'

// ─────────────────────────────────────────────────────────────────
// AdapterSpec Interface
// ─────────────────────────────────────────────────────────────────

/**
 * Provider-specific single-turn execution specification.
 *
 * Prefer `defineSingleTurnProviderBundle()` for public adapter authoring. The
 * base `adapter()` handles all shared orchestration: tool loops, fallback,
 * devtools, compositions.
 *
 * @typeParam TClient - The provider's SDK client type
 * @typeParam TRawResponse - The provider's raw API response type
 * @typeParam TRawStream - The provider's raw stream type
 * @typeParam TExtra - Provider-specific options (e.g., tool_choice for Anthropic)
 */
export interface AdapterSpec<
  TClient,
  TRawResponse = unknown,
  TRawStream = unknown,
  TExtra extends Record<string, unknown> = Record<string, unknown>,
> {
  /** Provider identifier for adaptation matching (e.g., 'anthropic', 'openai'). */
  readonly providerId: string

  /** Execute a non-streaming API call. Returns canonical + raw SDK response. */
  call(client: TClient, args: CallArgs<TExtra>): Promise<{ raw: TRawResponse; extracted: AdapterResponse }>

  /** Execute a streaming API call. Returns a stream handle. */
  stream(client: TClient, args: CallArgs<TExtra>): Promise<StreamHandle<TRawStream>>

  /**
   * Format assistant response + tool results for the next tool loop turn.
   * Each provider represents tool results differently.
   */
  appendToolRound(messages: Message[], assistantResponse: AdapterResponse, toolResults: ToolResultEntry[]): Message[]

  /** Map canonical GenerationSettings to provider-native field names. */
  mapSettings(settings: GenerationSettings): Record<string, unknown>

  /** Post-process z.toJSONSchema() output for this provider (optional). */
  sanitizeToolSchema?(schema: Record<string, unknown>): Record<string, unknown>

  /** Convert structured output schema to provider-native params (optional). */
  wrapOutputSchema?(schema: z.ZodType): Record<string, unknown>
}
