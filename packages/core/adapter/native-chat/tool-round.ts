/**
 * Default native chat tool-round transcript append.
 *
 * Thin compatibility wrapper over the canonical append law owned by the
 * transcript IR. Providers whose codec is compiled with
 * `defineProviderTranscriptCodec()` already append through
 * {@link appendCanonicalToolRound}; this export remains for specs that wire an
 * `appendToolRound` by hand.
 *
 * @module
 */

import type { Message } from '../../generation/messages'
import type { AdapterResponse, ToolResultEntry } from '../types'
import { appendCanonicalToolRound } from './transcript'

/**
 * Append an assistant tool-call turn and its tool results using canonical
 * Crux message metadata.
 *
 * @param messages - Existing canonical transcript.
 * @param assistant - Normalized assistant response containing tool calls.
 * @param results - Tool execution results to feed into the next provider call.
 * @returns A new canonical transcript including the tool round.
 */
export function appendNativeToolRound(
  messages: readonly Message[],
  assistant: AdapterResponse,
  results: readonly ToolResultEntry[],
): Message[] {
  return appendCanonicalToolRound(messages, assistant, results)
}
