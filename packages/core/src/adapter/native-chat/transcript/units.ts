/**
 * Canonical transcript IR shared by every native chat provider.
 *
 * Core owns the canonical transcript semantics — reading and writing tool-call
 * metadata, grouping adjacent tool results, and preserving rich tool output.
 * Provider packages only translate these neutral units to and from their own
 * SDK wire format through a {@link ProviderTranscriptDialect}. Keeping the IR
 * here means a provider can never interpret raw `Message.metadata` differently
 * from how its public converters do.
 *
 * @module
 */

import type { AssistantContentPart, ContentPart, MessageContent } from '../../../types/content'
import type { ToolModelOutput } from '../../../types/tool'
import type { NativeAssistantTurn } from '../types'

/**
 * One value, a readonly list of values, or nothing.
 *
 * Dialect hooks return this so a single canonical unit can encode to zero, one,
 * or many provider messages without the dialect managing array bookkeeping — a
 * `system` text unit may drop to nothing, a tool-results unit may fan out to one
 * provider message per result.
 *
 * @typeParam T - The wrapped value type.
 */
export type OneOrMany<T> = T | readonly T[] | undefined

/**
 * A model-requested tool invocation, normalized away from any SDK shape.
 *
 * `args` stays `unknown`: each provider serializes arguments differently (JSON
 * string, structured object, …) and that translation is wire-format work owned
 * by the dialect, not the canonical IR.
 */
export interface ProviderToolCall {
  /** Provider-issued (or Crux-synthesized) tool-call correlation id. */
  readonly id: string
  /** Declared tool name the model asked to run. */
  readonly name: string
  /** Raw, unparsed tool arguments as the model produced them. */
  readonly args: unknown
}

/**
 * A settled tool result, normalized away from any SDK shape.
 *
 * Both the plain `text` rendering and the structured `modelOutput` travel
 * together so a dialect can prefer rich native blocks (Anthropic images,
 * Google inline data) while always having a deterministic text fallback.
 */
export interface ProviderToolResult {
  /** Correlates this result with the originating {@link ProviderToolCall.id}. */
  readonly toolCallId: string
  /** Tool name, when the canonical transcript preserved it. */
  readonly toolName?: string
  /** Plain-text rendering of the result, always safe to send as a string. */
  readonly text: string
  /** Structured model output when the tool shaped its own result. */
  readonly modelOutput?: ToolModelOutput
  /** Whether the canonical transcript flagged this result as an error. */
  readonly isError?: boolean
  /** Error detail captured when shaping the model output failed. */
  readonly modelOutputError?: string
}

/** Options that affect provider transcript encoding without changing provider wire params. */
export type TranscriptEncodeOptions = Readonly<Record<never, never>>

/**
 * The neutral unit of a transcript: the smallest piece a dialect encodes.
 *
 * - `content` carries a `system` or `user` turn.
 * - `assistant` carries assistant content plus any tool calls it requested.
 * - `tool-results` carries one round of settled tool results, already grouped
 *   from the adjacent canonical `tool` messages that produced them.
 */
export type ProviderTranscriptUnit =
  | {
      readonly kind: 'content'
      readonly role: 'system' | 'user'
      readonly content: MessageContent
    }
  | {
      readonly kind: 'assistant'
      readonly content: string | readonly AssistantContentPart[]
      readonly toolCalls?: readonly ProviderToolCall[]
    }
  | {
      readonly kind: 'tool-results'
      readonly results: readonly ProviderToolResult[]
    }

/**
 * Canonical renderers passed to {@link ProviderTranscriptDialect.encodeToolResults}.
 *
 * These keep the one true reading of a {@link ProviderToolResult} in core, so
 * every dialect renders fallback text and decides the error flag the same way
 * instead of re-deriving it from metadata.
 */
export interface ToolResultEncodingHelpers {
  /** Deterministic plain-text rendering, used when the dialect cannot send rich content. */
  plainText(result: ProviderToolResult): string
  /** Rich content parts when the result is structured `content`, otherwise `undefined`. */
  contentParts(result: ProviderToolResult): readonly ContentPart[] | undefined
  /** Whether this result should be marked as an error on the wire. */
  errorFlag(result: ProviderToolResult): boolean
}

/**
 * The provider-owned half of transcript conversion.
 *
 * A dialect translates canonical {@link ProviderTranscriptUnit}s to its SDK
 * messages and back, and reads an assistant turn from a raw response. It never
 * sees raw `Message.metadata`: core extracts tool calls and tool results into
 * the IR first, so a dialect can only express genuine wire-format concerns.
 *
 * @typeParam TProviderMessage - Provider-native message shape accepted by the SDK.
 * @typeParam TRawResponse - Provider-native non-streaming response shape.
 */
export interface ProviderTranscriptDialect<TProviderMessage, TRawResponse> {
  /** Encode a `system`/`user` content turn into provider messages. */
  encodeContent(
    unit: Extract<ProviderTranscriptUnit, { kind: 'content' }>,
    options: TranscriptEncodeOptions,
  ): OneOrMany<TProviderMessage>
  /** Encode an assistant turn, including any requested tool calls. */
  encodeAssistant(
    unit: Extract<ProviderTranscriptUnit, { kind: 'assistant' }>,
    options: TranscriptEncodeOptions,
  ): OneOrMany<TProviderMessage>
  /** Encode a round of tool results, using `helpers` for canonical rendering. */
  encodeToolResults(
    unit: Extract<ProviderTranscriptUnit, { kind: 'tool-results' }>,
    helpers: ToolResultEncodingHelpers,
    options: TranscriptEncodeOptions,
  ): OneOrMany<TProviderMessage>
  /** Decode one provider message back into canonical transcript units. */
  decodeMessage(value: unknown): OneOrMany<ProviderTranscriptUnit>
  /** Read assistant text and tool-call intent from a raw provider response. */
  readAssistant(raw: TRawResponse): NativeAssistantTurn
}
