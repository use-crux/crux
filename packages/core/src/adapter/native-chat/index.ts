/**
 * Native-chat contracts used by single-turn provider runtimes.
 *
 * @module
 */

export { defineNativeChatProvider } from './define-native-chat-provider'
export { appendNativeToolRound } from './tool-round'
export {
  appendCanonicalToolRound,
  createToolResultEncodingHelpers,
  defineProviderTranscriptCodec,
  messagesToTranscriptUnits,
  transcriptUnitsToMessages,
} from './transcript'
export type {
  OneOrMany,
  ProviderToolCall,
  ProviderToolResult,
  ProviderTranscriptDialect,
  ProviderTranscriptUnit,
  TranscriptEncodeOptions,
  ToolResultEncodingHelpers,
} from './transcript'
export type {
  NativeChatHelpers,
} from './helper-types'
export type {
  NativeChatProvider,
  NativeProviderDepsArg,
} from './provider-types'
export type {
  NativeAssistantTurn,
  NativeAssistantReadContext,
  NativeCallMode,
  NativeChatProfile,
  NativeChatRequestArgs,
  NativeChatRequestContext,
  NativeProviderPort,
  NativeResponseMapper,
  NativeResponseMetadata,
  NativeTranscriptCodec,
} from './types'
