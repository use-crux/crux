/**
 * Canonical transcript IR and the codec compiler built on it.
 *
 * @module
 */

export {
  appendCanonicalToolRound,
  createToolResultEncodingHelpers,
  messagesToTranscriptUnits,
  transcriptUnitsToMessages,
} from './canonical'
export { defineProviderTranscriptCodec } from './define-provider-transcript-codec'
export type {
  OneOrMany,
  ProviderToolCall,
  ProviderToolResult,
  ProviderTranscriptDialect,
  ProviderTranscriptUnit,
  ToolResultEncodingHelpers,
} from './units'
