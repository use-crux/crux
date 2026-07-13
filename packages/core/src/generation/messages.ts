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

import type { AssistantContentPart, MessageContent } from '../types/content'

// ─────────────────────────────────────────────────────────────────
// Canonical Message Type
// ─────────────────────────────────────────────────────────────────

/**
 * Canonical framework-agnostic message.
 *
 * `content` is role-restricted: system/user/tool messages carry only
 * `ContentPart`s (text/media), while assistant messages may additionally
 * carry `ToolCallPart`/`ReasoningPart` lifecycle output. This keeps a
 * persisted or replayed non-assistant message from ever being misread as
 * containing a tool call or reasoning trace.
 *
 * @example
 * ```ts
 * const history: Message[] = [
 *   { role: 'user', content: 'Summarize this image.' },
 *   { role: 'assistant', content: [{ type: 'text', text: 'It shows...' }] },
 * ]
 * ```
 */
export type Message =
  | {
      role: 'system' | 'user' | 'tool'
      content: MessageContent
      metadata?: Record<string, unknown>
    }
  | {
      role: 'assistant'
      content: string | readonly AssistantContentPart[]
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
