/**
 * Internal native-chat compiler used by `@crux/core/adapter/profile`.
 *
 * Public adapter authors should import `defineAdapterProfile()` and
 * `nativeChat()` from `@crux/core/adapter/profile`.
 *
 * @module
 */

export { defineNativeChatProvider } from './define-native-chat-provider'
export { appendNativeToolRound } from './tool-round'
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
