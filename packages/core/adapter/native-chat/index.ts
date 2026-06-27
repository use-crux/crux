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
  ToolResultEncodingHelpers,
} from './transcript'
export type {
  NativeAssistantTurn,
  NativeCallMode,
  NativeChatHelpers,
  NativeChatProfile,
  NativeChatProvider,
  NativeChatRequestArgs,
  NativeChatRequestContext,
  NativeProviderDepsArg,
  NativeProviderPort,
  NativeResponseMapper,
  NativeResponseMetadata,
  NativeTranscriptCodec,
} from './types'
