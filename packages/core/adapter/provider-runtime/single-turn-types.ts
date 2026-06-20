/**
 * Single-turn provider runtime contracts.
 *
 * @module
 */

import type { NativeChatProfile as CoreNativeChatProfile, NativeProviderPort } from '../native-chat'
import type { ProviderRuntimeExtender } from './extension-types'
import type { SingleTurnProviderRuntime } from './runtime-types'

/**
 * Single-turn runtime contract accepted by `defineProviderRuntime()`.
 *
 * This is the normal provider authoring boundary for SDKs where Crux owns the
 * model/tool loop and the provider package owns one request, response, and
 * stream translation per turn.
 */
export type SingleTurnRuntimeContract<
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

/** Provider runtime spec for the single-turn branch. */
export interface SingleTurnProviderRuntimeSpec<
  TClient,
  TRequest,
  TRawResponse,
  TRawStream extends AsyncIterable<unknown>,
  TExtra extends Record<string, unknown>,
  TDeps extends Record<string, unknown> = Record<string, never>,
  TProviderMessage = unknown,
  TExtensions extends object = Record<string, never>,
> {
  /** Stable id used in metadata, observability, and provider matching. */
  readonly id: string
  /** Single-turn provider SDK mechanics. */
  readonly turn: SingleTurnRuntimeContract<TClient, TRequest, TRawResponse, TRawStream, TExtra, TDeps, TProviderMessage>
  /** Provider-specific capabilities to expose next to generation. */
  readonly extend?: ProviderRuntimeExtender<
    TClient,
    SingleTurnProviderRuntime<TClient, TRawResponse, TRawStream, TExtra>,
    TExtensions
  >
  /** Disallow mixing provider runtime dialects. */
  readonly loop?: never
}
