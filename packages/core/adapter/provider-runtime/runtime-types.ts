/**
 * Common provider-runtime wrapper types.
 *
 * @module
 */

import type { NativeChatHelpers } from '../native-chat'
import type { CruxAdapter } from '../define-adapter'
import type { CruxExecutor } from '../define-executor'

/** Closed set of provider runtime ownership models understood by core. */
export type ProviderOwnership = 'single-turn' | 'loop-owned'

/** @deprecated Use {@link ProviderOwnership}. */
export type ProviderRuntimeKind = ProviderOwnership

/** Dependency argument shape: required only when the provider declares deps. */
export type ProviderRuntimeDepsArg<TDeps extends Record<string, unknown>> =
  TDeps extends Record<string, never> ? readonly [deps?: TDeps] : readonly [deps: TDeps]

/** Runtime produced by a single-turn provider spec. */
export type SingleTurnProviderRuntime<
  TClient,
  TRawResponse,
  TRawStream,
  TExtra extends Record<string, unknown>,
> = CruxAdapter<TClient, TRawResponse, TRawStream, TExtra>

/** Runtime produced by a loop-owned provider spec. */
export type LoopOwnedProviderRuntime<TClient, TModel, TRawResponse, TRawStream> = CruxExecutor<
  TModel,
  TRawResponse,
  TRawStream
>

/** Runtime produced by either provider runtime branch. */
export type ProviderGenerationRuntime<
  TClient,
  TModel,
  TRawResponse,
  TRawStream,
  TExtra extends Record<string, unknown>,
> =
  | SingleTurnProviderRuntime<TClient, TRawResponse, TRawStream, TExtra>
  | LoopOwnedProviderRuntime<TClient, TModel, TRawResponse, TRawStream>

/** Runtime returned by `defineProviderRuntime()`. */
export interface DefinedProviderRuntime<
  TClient,
  TModel = string,
  TRawResponse = unknown,
  TRawStream = unknown,
  TExtra extends Record<string, unknown> = Record<string, unknown>,
  TDeps extends Record<string, unknown> = Record<string, never>,
  TRuntime = ProviderGenerationRuntime<TClient, TModel, TRawResponse, TRawStream, TExtra>,
  TExtensions extends object = Record<string, never>,
  TOwnership extends ProviderOwnership = ProviderOwnership,
> {
  /** Stable provider runtime id. */
  readonly id: string
  /** Which side owns the model/tool loop for this provider runtime. */
  readonly ownership: TOwnership
  /** Bind the runtime to a provider client and optional provider-owned dependencies. */
  create(client: TClient, ...depsArg: ProviderRuntimeDepsArg<TDeps>): TRuntime & TExtensions
}

/**
 * Runtime returned for single-turn provider specs.
 *
 * In addition to the full Crux adapter runtime factory, single-turn providers
 * can create lightweight text/object helper functions from the exact same
 * request and response hooks.
 */
export interface DefinedSingleTurnProviderRuntime<
  TClient,
  TRawResponse,
  TRawStream extends AsyncIterable<unknown>,
  TExtra extends Record<string, unknown>,
  TDeps extends Record<string, unknown> = Record<string, never>,
  TExtensions extends object = Record<string, never>,
> extends DefinedProviderRuntime<
  TClient,
  string,
  TRawResponse,
  TRawStream,
  TExtra,
  TDeps,
  SingleTurnProviderRuntime<TClient, TRawResponse, TRawStream, TExtra>,
  TExtensions,
  'single-turn'
> {
  /** Create lightweight framework-agnostic generation helpers. */
  helpers(...depsArg: ProviderRuntimeDepsArg<TDeps>): NativeChatHelpers<TClient>
}
