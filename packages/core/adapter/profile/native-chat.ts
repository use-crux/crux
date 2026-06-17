/**
 * Native chat profile driver.
 *
 * @module
 */

import { defineNativeChatProvider } from '../native-chat'
import type {
  NativeAssistantTurn,
  NativeChatRequestArgs,
  NativeChatHelpers,
  NativeChatProfile as CoreNativeChatProfile,
  NativeProviderPort,
  NativeResponseMetadata,
  NativeTranscriptCodec,
} from '../native-chat'
import type { CruxAdapter } from '../define-adapter'
import type { AdapterDriver, AdapterProfileContext, AdapterProfileDepsArg } from './types'

/**
 * Public native-chat profile shape.
 *
 * The outer `defineAdapterProfile({ id })` call supplies the provider id.
 * The profile owns the provider wire hooks and the binder that narrows a
 * concrete SDK client to the small native-chat port Crux needs.
 */
export type NativeChatProfile<
  TClient,
  TRequest,
  TRawResponse,
  TRawStream extends AsyncIterable<unknown>,
  TExtra extends Record<string, unknown>,
  TDeps extends Record<string, unknown> = Record<string, never>,
  TProviderMessage = unknown,
> = Omit<CoreNativeChatProfile<TRequest, TRawResponse, TRawStream, TExtra, TDeps, TProviderMessage>, 'providerId'> & {
  /** Bind a concrete SDK client to the narrow native provider port. */
  readonly bind: (client: TClient) => NativeProviderPort<TRequest, TRawResponse, TRawStream>
}

/** Runtime produced by a native-chat profile. */
export type NativeChatRuntime<TClient, TRawResponse, TRawStream, TExtra extends Record<string, unknown>> = CruxAdapter<
  TClient,
  TRawResponse,
  TRawStream,
  TExtra
>

/** Driver returned by `nativeChat()`. */
export interface NativeChatDriver<
  TClient,
  TRequest,
  TRawResponse,
  TRawStream extends AsyncIterable<unknown>,
  TExtra extends Record<string, unknown>,
  TDeps extends Record<string, unknown> = Record<string, never>,
> extends AdapterDriver<
  TClient,
  string,
  TRawResponse,
  TRawStream,
  TExtra,
  TDeps,
  NativeChatRuntime<TClient, TRawResponse, TRawStream, TExtra>
> {
  /**
   * Create lightweight generation helpers from the same native-chat profile.
   *
   * These helpers intentionally bypass prompt resolution, policy sessions,
   * memory, and observability. Use them only for core APIs that accept
   * framework-agnostic `GenerateTextFn` / `GenerateObjectFn` helpers.
   */
  helpers(profileId: string, ...depsArg: AdapterProfileDepsArg<TDeps>): NativeChatHelpers<TClient>
}

/**
 * Compile a native chat profile into an adapter profile driver.
 *
 * Use this for SDKs that expose raw single-turn chat calls and leave the
 * tool loop to Crux. The driver compiles provider hooks into Crux's
 * core-step adapter runtime.
 *
 * @param profile - Provider wire hooks plus a client binder.
 * @returns A native-chat driver for `defineAdapterProfile()`.
 */
export function nativeChat<
  TClient,
  TRequest,
  TRawResponse,
  TRawStream extends AsyncIterable<unknown>,
  TExtra extends Record<string, unknown>,
  TDeps extends Record<string, unknown> = Record<string, never>,
  TProviderMessage = unknown,
>(
  profile: NativeChatProfile<TClient, TRequest, TRawResponse, TRawStream, TExtra, TDeps, TProviderMessage>,
): NativeChatDriver<TClient, TRequest, TRawResponse, TRawStream, TExtra, TDeps> {
  const { bind, ...nativeProfile } = profile
  const compile = (providerId: string) =>
    defineNativeChatProvider({
      ...nativeProfile,
      providerId,
    })

  return Object.freeze({
    kind: 'native-chat' as const,
    create(
      ctx: AdapterProfileContext<string>,
      client: TClient,
      ...depsArg: AdapterProfileDepsArg<TDeps>
    ): NativeChatRuntime<TClient, TRawResponse, TRawStream, TExtra> {
      return compile(ctx.id).createFor(bind, ...depsArg)(client)
    },
    helpers(profileId: string, ...depsArg: AdapterProfileDepsArg<TDeps>): NativeChatHelpers<TClient> {
      return compile(profileId).helpers(bind, ...depsArg)
    },
  })
}

export type {
  NativeAssistantTurn,
  NativeChatHelpers,
  NativeChatRequestArgs,
  NativeProviderPort,
  NativeResponseMetadata,
  NativeTranscriptCodec,
}
