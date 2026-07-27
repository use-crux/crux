/**
 * Facade contracts produced by the native chat provider compiler.
 *
 * @module
 */

import type { CruxAdapter } from "../define-adapter";
import type { AdapterSpec } from "../spec";
import type { NativeChatHelpers } from "./helper-types";
import type {
  NativeChatProfile,
  NativeProviderPort,
} from "./types";

/** Dependency argument shape: required only when the profile declares deps. */
export type NativeProviderDepsArg<TDeps extends Record<string, unknown>> =
  TDeps extends Record<string, never>
    ? readonly [deps?: TDeps]
    : readonly [deps: TDeps];

/** Compiled native chat provider facade. */
export interface NativeChatProvider<
  TRequest,
  TRawResponse,
  TRawStream extends AsyncIterable<unknown>,
  TExtra extends Record<string, unknown>,
  TDeps extends Record<string, unknown> = Record<string, never>,
  TProviderMessage = unknown,
> {
  /** Original provider recipe. */
  readonly profile: NativeChatProfile<
    TRequest,
    TRawResponse,
    TRawStream,
    TExtra,
    TDeps,
    TProviderMessage
  >;

  /** Compile the profile into an `AdapterSpec` for a provider SDK client. */
  specFor<TClient>(
    bind: (
      client: TClient,
    ) => NativeProviderPort<TRequest, TRawResponse, TRawStream>,
    ...deps: NativeProviderDepsArg<TDeps>
  ): AdapterSpec<TClient, TRawResponse, TRawStream, TExtra, TRequest>;

  /** Compile the profile into the public Crux adapter factory. */
  createFor<TClient>(
    bind: (
      client: TClient,
    ) => NativeProviderPort<TRequest, TRawResponse, TRawStream>,
    ...deps: NativeProviderDepsArg<TDeps>
  ): (
    client: TClient,
  ) => CruxAdapter<TClient, TRawResponse, TRawStream, TExtra, TRequest>;

  /** Create lightweight helpers from the same request/response profile. */
  helpers<TClient>(
    bind: (
      client: TClient,
    ) => NativeProviderPort<TRequest, TRawResponse, TRawStream>,
    ...deps: NativeProviderDepsArg<TDeps>
  ): NativeChatHelpers<TClient>;
}
