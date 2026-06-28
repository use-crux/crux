/**
 * Core types for the provider adapter abstraction.
 *
 * These types define the canonical shapes used by `adapter()` to
 * orchestrate tool loops and normalize responses across AI providers.
 *
 * @module
 */

import type { z } from 'zod'
import type { TraceMeta, GenerationSettings } from '../generation/types'
import type { SystemBlock } from '../resolver/types'
import type { Message } from '../generation/messages'
import type { ToolModelOutput } from '../types/tool'

// ─────────────────────────────────────────────────────────────────
// Adapter Response
// ─────────────────────────────────────────────────────────────────

/** Canonical response -- what the base uses for tool loop logic. */
export interface AdapterResponse {
  text: string
  toolCalls: Array<{ id: string; name: string; args: unknown }> | undefined
  usage: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
    reasoningTokens?: number
  }
  finishReason: string | undefined
  responseId: string | undefined
  actualModelId: string | undefined
}

// ─────────────────────────────────────────────────────────────────
// Call Args
// ─────────────────────────────────────────────────────────────────

/** Canonical args assembled by the base from prompt resolution. */
export interface CallArgs<TExtra extends Record<string, unknown> = Record<string, unknown>> {
  model: string
  system: string | undefined
  /**
   * System message blocks with optional provider-level caching hints.
   * Joining all `block.text` with `\n\n` produces the `system` string.
   * Adapters that support provider caching (e.g., Anthropic) can use
   * `providerCache` to emit native cache markers per block.
   */
  systemBlocks: readonly SystemBlock[] | undefined
  messages: Message[]
  settings: Record<string, unknown>
  schema: z.ZodType | undefined
  schemaParams: Record<string, unknown> | undefined
  tools:
    | Array<{
        name: string
        description: string
        parameters: Record<string, unknown>
        execute: (
          args: unknown,
          options?: { readonly toolCallId?: string; readonly messages?: readonly unknown[] },
        ) => unknown | Promise<unknown>
        needsApproval?:
          | boolean
          | ((args: unknown, options: { toolCallId?: string; messages?: Message[] }) => boolean | PromiseLike<boolean>)
        toModelOutput?: (args: {
          toolCallId: string
          input: Record<string, unknown>
          output: unknown
        }) => ToolModelOutput | Promise<ToolModelOutput>
      }>
    | undefined
  extra: TExtra
}

// ─────────────────────────────────────────────────────────────────
// Stream Handle
// ─────────────────────────────────────────────────────────────────

/** Stream handle returned by the adapter's stream method. */
export interface StreamHandle<TRawStream> {
  rawStream: TRawStream & AsyncIterable<unknown>
  extractTextDelta: (chunk: unknown) => string | undefined
  completion: () => Promise<TraceMeta | undefined>
}

// ─────────────────────────────────────────────────────────────────
// Tool Result
// ─────────────────────────────────────────────────────────────────

/** Tool result to feed back into the next call. */
export interface ToolResultEntry {
  toolCallId: string
  name: string
  output?: unknown
  modelOutput: ToolModelOutput
  content: string
  outputSize: number
  modelOutputSize: number
  modelOutputError?: string
  isError?: boolean
}

// ─────────────────────────────────────────────────────────────────
// Status Delta
// ─────────────────────────────────────────────────────────────────

/** Status delta for counter-based operations. Same shape as plan/status. */
export type StatusDelta =
  | { readonly type: 'add' }
  | { readonly type: 'update'; readonly from: string; readonly to: string }
  | { readonly type: 'remove'; readonly status: string }
