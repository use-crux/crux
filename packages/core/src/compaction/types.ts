/**
 * Shared types for context compaction primitives.
 *
 * Provides framework-agnostic generate function abstractions that any SDK
 * (Vercel AI SDK, OpenAI, Google GenAI) can implement.
 *
 * @module
 */

import type { z } from "zod";
import type { Message, CompactionResult } from "../generation/messages";
import type { RoutingReceipt } from "../routing/receipt";
import type { Storage } from "../storage";

// ── Generate Function Abstractions ──────────────────────────────────

/** Common controls accepted by a framework-agnostic text generation call. */
interface GenerateTextCommonOptions {
  readonly model: unknown;
  readonly system?: string;
  readonly maxOutputTokens?: number;
}

/** Framework-agnostic text generation function. Wraps any SDK's generateText. */
export type GenerateTextFn = (
  options: GenerateTextCommonOptions &
    (
      | { readonly prompt: string; readonly messages?: never }
      | { readonly messages: readonly Message[]; readonly prompt?: never }
    ),
) => Promise<{ text: string; routing?: RoutingReceipt }>;

/** Optional generation controls used to turn media parts into bounded text. */
export interface CompactionMediaConfig {
  /** Generator used for media descriptions. Defaults to the summary generator. */
  readonly generate?: GenerateTextFn;
  /** Model used for media descriptions. Defaults to the summary model. */
  readonly model?: unknown;
  /** Maximum characters retained from each media description. Default: 4000. */
  readonly maxCharsPerPart?: number;
}

/**
 * Common controls accepted by a framework-agnostic structured generation call.
 *
 * @typeParam T - Structured value produced after schema validation.
 */
export interface GenerateObjectCommonOptions<T> {
  /** Model reference resolved by the implementation for this call. */
  readonly model: unknown;
  /** Optional system instruction applied before the prompt or messages. */
  readonly system?: string;
  /** Zod schema describing and validating the returned object. */
  readonly schema: z.ZodType<T>;
  /** Provider temperature forwarded when the caller needs deterministic generation. */
  readonly temperature?: number;
  /** Provider nucleus-sampling setting forwarded when the caller needs deterministic generation. */
  readonly topP?: number;
}

/**
 * Exclusive canonical input accepted by structured generation.
 *
 * Canonical messages preserve multimodal content for provider adapters. A
 * caller supplies exactly one input form.
 */
export type GenerateObjectInput =
  | { readonly prompt: string; readonly messages?: never }
  | { readonly messages: readonly Message[]; readonly prompt?: never };

/**
 * Framework-agnostic structured output function.
 *
 * Accepts either a text prompt or canonical messages. Provider-native helpers
 * send `schema` to their provider's structured-output mechanism and return the
 * provider/schema validated `{ object }`. They do not imply the full Crux
 * prompt runtime: prompt resolution, validation retry, safety, Eval evidence,
 * tools, memory, and instrumentation are only present when the helper is
 * explicitly adapter-backed, such as one created with
 * `createGenerateObjectFnFromGenerate()`.
 *
 * @typeParam T - Structured value produced after schema validation.
 */
export type GenerateObjectFn = <T>(
  options: GenerateObjectCommonOptions<T> & GenerateObjectInput,
) => Promise<{
  readonly object: T;
  readonly routing?: RoutingReceipt;
}>;

// ── summarizeMessages ───────────────────────────────────────────────

export interface SummarizeConfig {
  /** Messages to summarize. */
  messages: readonly Message[];
  /** Text generation function (any SDK adapter). */
  generate: GenerateTextFn;
  /** Model to use for summarization. */
  model: unknown;
  /** Max tokens for the summary output. Default: 500. */
  maxTokens?: number;
  /** Aspects to prioritize in the summary (e.g. 'decisions', 'tool_results'). */
  focus?: string[];
  /** Optional media-description overrides. */
  media?: CompactionMediaConfig;
}

/** Options for `compactConversation()`. */
export interface CompactConversationArgs {
  /** Messages that just fell out of the recent window. */
  evictedMessages: Message[];
  /** Existing running summary from thread metadata, or an empty string. */
  existingSummary: string;
  /** Text generation function used only when messages need summarizing. */
  generate: GenerateTextFn;
  /** Model used for generated summaries. */
  model: unknown;
  /** Maximum generated summary size in tokens. Default: 1000. */
  summaryBudget?: number;
  /** Optional media-description overrides. */
  media?: CompactionMediaConfig;
}

// Re-export CompactionResult — it's the return type of summarizeMessages
export type { CompactionResult };

// ── createSlidingWindow ─────────────────────────────────────────────

export interface SlidingWindowConfig {
  /** Number of recent messages to keep verbatim. */
  windowSize: number;
  /** Text generation function for summarization. */
  generate: GenerateTextFn;
  /** Model to use for summarization. */
  model: unknown;
  /** Max tokens for the running summary. Default: 1000. */
  summaryBudget?: number;
  /** Optional media-description overrides. */
  media?: CompactionMediaConfig;
  /** Storage used for durable messages and their media assets. */
  storage?: Storage;
  /** Namespace key for this window instance. Default: 'default'. */
  id?: string;
}

export interface SlidingWindow {
  /** Append a message. Triggers compaction when window overflows. */
  push(message: Message): Promise<void>;
  /** Get compacted messages: [summary_system_msg, ...recent]. */
  getMessages(): Promise<Message[]>;
  /** Current compaction statistics. */
  getStats(): SlidingWindowStats;
}

export interface SlidingWindowStats {
  /** Total messages received (including evicted). */
  totalMessages: number;
  /** Messages currently in the window. */
  windowedMessages: number;
  /** Token count of the running summary. */
  summaryTokens: number;
  /** Total number of messages evicted and summarized. */
  evictions: number;
}

// ── createBudgetManager ─────────────────────────────────────────────

export interface BudgetConfig {
  /** Hard token limit. */
  limit: number;
  /** Pressure threshold for 'warning' level (0–1). Default: 0.8. */
  warningThreshold?: number;
  /** Pressure threshold for 'critical' level (0–1). Default: 0.95. */
  criticalThreshold?: number;
}

export interface BudgetManager {
  /** Report token usage for a source. Replaces any previous value for that source. */
  report(source: string, tokens: number): void;
  /** Check current budget state. */
  check(): BudgetState;
  /** Reset all reported sources. */
  reset(): void;
}

export interface BudgetState {
  /** Total tokens used across all sources. */
  used: number;
  /** Tokens remaining before limit. */
  available: number;
  /** Usage pressure (0–1). */
  pressure: number;
  /** Pressure level classification. */
  level: "normal" | "warning" | "critical";
  /** Per-source token breakdown. */
  breakdown: Record<string, number>;
}

// ── extractKeyFacts ─────────────────────────────────────────────────

export interface ExtractConfig<T extends z.ZodType> {
  /** Messages to extract facts from. */
  messages: Message[];
  /** Structured output generation function (any SDK adapter). */
  generate: GenerateObjectFn;
  /** Model to use for extraction. */
  model: unknown;
  /** Zod schema defining the expected output structure. */
  schema: T;
}
