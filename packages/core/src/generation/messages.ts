/**
 * Canonical message type for `@use-crux/core`.
 *
 * Each AI SDK has its own message format (AI SDK's `CoreMessage`, OpenAI's
 * `ChatCompletionMessageParam`, etc.). Compaction and memory operate on
 * messages, so we need a framework-agnostic canonical type.
 *
 * Adapters export `toMessages()` and `fromMessages()` converters.
 * Compaction/memory work on `Message[]`; adapters handle the boundary.
 *
 * @module
 */

import type { MessageContent } from '../types/content'

// ─────────────────────────────────────────────────────────────────
// Canonical Message Type
// ─────────────────────────────────────────────────────────────────

/** Canonical framework-agnostic message. */
export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: MessageContent
  metadata?: Record<string, unknown>
}

/** Result of a compaction operation. */
export interface CompactionResult {
  /** The compressed summary text. */
  summary: string
  /** Token count of the input messages. */
  tokensBefore: number
  /** Token count of the summary. */
  tokensAfter: number
  /** Compression ratio (e.g., 0.15 = 85% reduction). */
  ratio: number
}
