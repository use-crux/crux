/**
 * `@crux/core/adapter/profile` — public adapter profile authoring.
 *
 * Profiles are the public authoring surface for provider and SDK-loop
 * runtimes. They compile into Crux's `AdapterSpec` and `ExecutorSpec`
 * execution engines instead of duplicating policy.
 *
 * @module
 */

export { defineAdapterProfile } from './define'
export { nativeChat } from './native-chat'
export { sdkLoop } from './sdk-loop'
export type {
  AdapterDriver,
  AdapterProfile,
  AdapterProfileContext,
  AdapterProfileDepsArg,
  CruxGenerationRuntime,
  DefinedAdapterProfile,
} from './types'
export type {
  NativeAssistantTurn,
  NativeChatDriver,
  NativeChatHelpers,
  NativeChatProfile,
  NativeChatRequestArgs,
  NativeChatRuntime,
  NativeProviderPort,
  NativeResponseMetadata,
  NativeTranscriptCodec,
} from './native-chat'
export type { SdkLoopProfile, SdkLoopRuntime } from './sdk-loop'
