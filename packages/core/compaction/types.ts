/**
 * Shared types for context compaction primitives.
 *
 * Provides framework-agnostic generate function abstractions that any SDK
 * (Vercel AI SDK, OpenAI, Google GenAI) can implement.
 *
 * @module
 */

import type { z } from 'zod'
import type { Message, CompactionResult } from '../generation/messages'
import type { RoutingReceipt } from '../routing/receipt'
import type { RecordStore } from '../storage'

// ── Generate Function Abstractions ──────────────────────────────────

/** Framework-agnostic text generation function. Wraps any SDK's generateText. */
export type GenerateTextFn = (options: {
  model: unknown;
  system?: string;
  prompt: string;
}) => Promise<{ text: string; routing?: RoutingReceipt }>

/**
 * Framework-agnostic structured output function.
 *
 * Provider-native helpers send `schema` to their provider's structured-output
 * mechanism and return the provider/schema validated `{ object }`. They do not
 * imply the full Crux prompt runtime: prompt resolution, validation retry,
 * safety, cassettes, tools, memory, and instrumentation are only present when
 * the helper is explicitly adapter-backed, such as one created with
 * `createGenerateObjectFnFromGenerate()`.
 */
export type GenerateObjectFn = <T>(options: {
  model: unknown
  system?: string
  prompt: string
  schema: z.ZodType<T>
}) => Promise<{ object: T; routing?: RoutingReceipt }>

// ── summarizeMessages ───────────────────────────────────────────────

export interface SummarizeConfig {
  /** Messages to summarize. */
  messages: Message[]
  /** Text generation function (any SDK adapter). */
  generate: GenerateTextFn
  /** Model to use for summarization. */
  model: unknown
  /** Max tokens for the summary output. Default: 500. */
  maxTokens?: number
  /** Aspects to prioritize in the summary (e.g. 'decisions', 'tool_results'). */
  focus?: string[]
}

// Re-export CompactionResult — it's the return type of summarizeMessages
export type { CompactionResult }

// ── createSlidingWindow ─────────────────────────────────────────────

export interface SlidingWindowConfig {
  /** Number of recent messages to keep verbatim. */
  windowSize: number
  /** Text generation function for summarization. */
  generate: GenerateTextFn
  /** Model to use for summarization. */
  model: unknown
  /** Max tokens for the running summary. Default: 1000. */
  summaryBudget?: number
  /** Record store for persistence. Defaults to `inMemoryRecordStore()`. */
  records?: RecordStore
  /** Namespace key for this window instance. Default: 'default'. */
  id?: string
}

export interface SlidingWindow {
  /** Append a message. Triggers compaction when window overflows. */
  push(message: Message): Promise<void>
  /** Get compacted messages: [summary_system_msg, ...recent]. */
  getMessages(): Promise<Message[]>
  /** Current compaction statistics. */
  getStats(): SlidingWindowStats
}

export interface SlidingWindowStats {
  /** Total messages received (including evicted). */
  totalMessages: number
  /** Messages currently in the window. */
  windowedMessages: number
  /** Token count of the running summary. */
  summaryTokens: number
  /** Total number of messages evicted and summarized. */
  evictions: number
}

// ── createBudgetManager ─────────────────────────────────────────────

export interface BudgetConfig {
  /** Hard token limit. */
  limit: number
  /** Pressure threshold for 'warning' level (0–1). Default: 0.8. */
  warningThreshold?: number
  /** Pressure threshold for 'critical' level (0–1). Default: 0.95. */
  criticalThreshold?: number
}

export interface BudgetManager {
  /** Report token usage for a source. Replaces any previous value for that source. */
  report(source: string, tokens: number): void
  /** Check current budget state. */
  check(): BudgetState
  /** Reset all reported sources. */
  reset(): void
}

export interface BudgetState {
  /** Total tokens used across all sources. */
  used: number
  /** Tokens remaining before limit. */
  available: number
  /** Usage pressure (0–1). */
  pressure: number
  /** Pressure level classification. */
  level: 'normal' | 'warning' | 'critical'
  /** Per-source token breakdown. */
  breakdown: Record<string, number>
}

// ── extractKeyFacts ─────────────────────────────────────────────────

export interface ExtractConfig<T extends z.ZodType> {
  /** Messages to extract facts from. */
  messages: Message[]
  /** Structured output generation function (any SDK adapter). */
  generate: GenerateObjectFn
  /** Model to use for extraction. */
  model: unknown
  /** Zod schema defining the expected output structure. */
  schema: T
}
