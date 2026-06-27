/**
 * Compile a provider {@link ProviderTranscriptDialect} into a
 * {@link NativeTranscriptCodec}.
 *
 * The compiler wires the dialect's wire-format hooks into core's canonical
 * transcript semantics: `fromMessages` extracts neutral units and lets the
 * dialect encode each one, `toMessages` decodes provider messages into units
 * and lets core rebuild canonical messages, and `appendToolRound` always uses
 * the one canonical append law. A provider therefore encodes its public
 * `fromMessages()` and appends runtime tool rounds through the exact same path.
 *
 * @module
 */

import {
  appendCanonicalToolRound,
  createToolResultEncodingHelpers,
  messagesToTranscriptUnits,
  transcriptUnitsToMessages,
} from './canonical'
import type { NativeTranscriptCodec } from '../types'
import type { OneOrMany, ProviderTranscriptDialect, ProviderTranscriptUnit } from './units'

/**
 * Compile a transcript dialect into a native transcript codec.
 *
 * @typeParam TProviderMessage - Provider-native message shape accepted by the SDK.
 * @typeParam TRawResponse - Provider-native non-streaming response shape.
 * @param dialect - Provider-owned wire encode/decode hooks.
 * @returns A codec ready to drop into a `NativeChatProfile.transcript`.
 *
 * @example
 * ```ts
 * export const openAITranscript = defineProviderTranscriptCodec<
 *   OpenAI.ChatCompletionMessageParam,
 *   ChatCompletion
 * >({
 *   encodeText: ({ role, text }) => ({ role, content: text }),
 *   encodeAssistant: ({ text, toolCalls = [] }) => encodeOpenAIAssistant(text, toolCalls),
 *   encodeToolResults: ({ results }, helpers) => results.map((r) => encodeOpenAIToolResult(r, helpers)),
 *   decodeMessage: decodeOpenAIMessage,
 *   readAssistant: readOpenAIAssistant,
 * })
 * ```
 */
export function defineProviderTranscriptCodec<TProviderMessage, TRawResponse>(
  dialect: ProviderTranscriptDialect<TProviderMessage, TRawResponse>,
): NativeTranscriptCodec<TProviderMessage, TRawResponse> {
  const helpers = createToolResultEncodingHelpers()

  const encodeUnit = (unit: ProviderTranscriptUnit): OneOrMany<TProviderMessage> => {
    switch (unit.kind) {
      case 'text':
        return dialect.encodeText(unit)
      case 'assistant':
        return dialect.encodeAssistant(unit)
      case 'tool-results':
        return dialect.encodeToolResults(unit, helpers)
    }
  }

  return {
    fromMessages: (messages) => messagesToTranscriptUnits(messages).flatMap((unit) => toArray(encodeUnit(unit))),
    toMessages: (messages) =>
      transcriptUnitsToMessages(messages.flatMap((message) => toArray(dialect.decodeMessage(message)))),
    readAssistant: (raw) => dialect.readAssistant(raw),
    appendToolRound: appendCanonicalToolRound,
  }
}

/** Normalize a `OneOrMany` dialect result into a flat array. */
function toArray<T>(value: OneOrMany<T>): readonly T[] {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value as T]
}
