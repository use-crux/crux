/**
 * `@crux/core/adapter/native-chat` — profile helper for raw chat SDKs.
 *
 * Use this when a provider SDK exposes native text, structured-output, and
 * streaming chat calls, while Crux should own prompt resolution, safety,
 * tool loops, validation retry, and tracing.
 *
 * @module
 */

export { defineNativeChatProvider } from './define-native-chat-provider'
export { appendNativeToolRound } from './tool-round'
export type {
  NativeCallMode,
  NativeChatHelpers,
  NativeChatProfile,
  NativeChatProvider,
  NativeChatRequestContext,
  NativeMessageCodec,
  NativeProviderDepsArg,
  NativeProviderPort,
} from './types'
