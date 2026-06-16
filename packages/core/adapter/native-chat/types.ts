/**
 * Public contracts for native chat provider profiles.
 *
 * A native chat profile describes provider wire facts, while Crux keeps owning
 * prompt resolution, safety, tool execution, validation retry, and tracing.
 *
 * @module
 */

import type { z } from 'zod'
import type { GenerateObjectFn, GenerateTextFn } from '../../compaction'
import type { Message } from '../../messages'
import type { GenerationSettings, TraceMeta } from '../../types'
import type { CruxAdapter } from '../define-adapter'
import type { AdapterSpec } from '../spec'
import type { AdapterResponse, CallArgs, ToolResultEntry } from '../types'

/** Native call surface selected from canonical Crux call arguments. */
export type NativeCallMode = 'text' | 'structured'

/**
 * Bound SDK port for one native chat provider.
 *
 * Provider packages adapt their SDK client into this narrow port so tests can
 * replace SDK-shaped clients with small scripted ports.
 *
 * @typeParam TRequest - Provider-native request body.
 * @typeParam TRawResponse - Provider-native non-streaming response.
 * @typeParam TRawStream - Provider-native async stream.
 */
export interface NativeProviderPort<TRequest, TRawResponse, TRawStream extends AsyncIterable<unknown>> {
  /** Execute a non-streaming provider call. */
  call(request: TRequest, mode: NativeCallMode): Promise<TRawResponse>
  /** Start a provider-native stream. */
  stream(request: TRequest): Promise<TRawStream>
}

/**
 * Provider-owned transcript conversion.
 *
 * The helper does not inspect provider message shapes directly. Profiles keep
 * codecs here so packages can re-export the same conversions they already
 * expose as `fromMessages` / `toMessages`.
 */
export interface NativeMessageCodec<TProviderMessage = unknown> {
  /** Convert canonical Crux messages into provider-native chat messages. */
  fromCrux(messages: readonly Message[]): readonly TProviderMessage[] | TProviderMessage
  /** Convert provider-native chat messages back into canonical Crux messages. */
  toCrux(messages: readonly TProviderMessage[]): Message[]
}

/** Context passed to provider request builders. */
export interface NativeChatRequestContext<TDeps extends Record<string, unknown>> {
  /** Whether the call should use the provider's text or structured surface. */
  readonly mode: NativeCallMode
  /** Provider-owned collaborators such as cache managers or resolvers. */
  readonly deps: TDeps
}

/**
 * Provider recipe compiled into Crux's public adapter API.
 *
 * Keep this profile focused on provider wire facts: request assembly, raw
 * response normalization, stream delta extraction, settings/schema mapping,
 * transcript codecs, and unusual provider dependencies.
 *
 * @typeParam TRequest - Provider-native request body.
 * @typeParam TRawResponse - Provider-native non-streaming response.
 * @typeParam TRawStream - Provider-native async stream.
 * @typeParam TExtra - Provider-specific call options accepted by the adapter.
 * @typeParam TDeps - Provider-owned dependencies threaded into request builders.
 */
export interface NativeChatProfile<
  TRequest,
  TRawResponse,
  TRawStream extends AsyncIterable<unknown>,
  TExtra extends Record<string, unknown>,
  TDeps extends Record<string, unknown> = Record<string, never>,
> {
  /** Stable provider identifier used in traces and adapter matching. */
  readonly providerId: string

  /** Build a provider-native request from canonical Crux call arguments. */
  request(args: CallArgs<TExtra>, ctx: NativeChatRequestContext<TDeps>): TRequest | Promise<TRequest>

  /** Normalize a provider-native response into Crux's canonical response. */
  response(raw: TRawResponse): AdapterResponse

  /**
   * Read provider-native structured output when the SDK returns it separately
   * from assistant text.
   *
   * `helpers().createGenerateObjectFn()` prefers this value before falling
   * back to JSON parsing `response(raw).text`. Adapter `generate()` still
   * uses the canonical text path so validation retry and transcript behavior
   * remain centralized in core.
   */
  structuredObject?(raw: TRawResponse): unknown | undefined

  /** Provider-native streaming hooks. */
  readonly stream: {
    /** Optional stream-specific request adjustment, such as setting `stream: true`. */
    request?(request: TRequest): TRequest
    /** Extract one text delta from a provider stream chunk. */
    textDelta(chunk: unknown): string | undefined
    /** Optional completion metadata read after stream consumption. */
    completion?(stream: TRawStream): Promise<TraceMeta | undefined>
  }

  /** Map canonical generation settings to provider-native field names. */
  settings(settings: GenerationSettings): Record<string, unknown>

  /** Convert a Zod output schema to provider-native structured-output params. */
  outputSchema?(schema: z.ZodType): Record<string, unknown>

  /** Post-process tool schemas before provider request assembly. */
  sanitizeToolSchema?(schema: Record<string, unknown>): Record<string, unknown>

  /** Provider-owned transcript codec. */
  readonly messages: NativeMessageCodec

  /** Optional provider-specific tool-round transcript append. */
  appendToolRound?(
    messages: readonly Message[],
    assistant: AdapterResponse,
    results: readonly ToolResultEntry[],
  ): Message[]
}

/** Dependency argument shape: required only when the profile declares deps. */
export type NativeProviderDepsArg<TDeps extends Record<string, unknown>> =
  TDeps extends Record<string, never> ? readonly [deps?: TDeps] : readonly [deps: TDeps]

/** Bound helper functions generated from the same native chat profile path. */
export interface NativeChatHelpers<TClient> {
  /** Create a framework-agnostic text generation helper for compaction/scoring APIs. */
  createGenerateTextFn(client: TClient, model: string): GenerateTextFn
  /** Create a framework-agnostic structured generation helper for compaction/scoring APIs. */
  createGenerateObjectFn(client: TClient, model: string): GenerateObjectFn
}

/** Compiled native chat provider facade. */
export interface NativeChatProvider<
  TRequest,
  TRawResponse,
  TRawStream extends AsyncIterable<unknown>,
  TExtra extends Record<string, unknown>,
  TDeps extends Record<string, unknown> = Record<string, never>,
> {
  /** Original provider recipe. */
  readonly profile: NativeChatProfile<TRequest, TRawResponse, TRawStream, TExtra, TDeps>

  /** Compile the profile into an `AdapterSpec` for a provider SDK client. */
  specFor<TClient>(
    bind: (client: TClient) => NativeProviderPort<TRequest, TRawResponse, TRawStream>,
    ...deps: NativeProviderDepsArg<TDeps>
  ): AdapterSpec<TClient, TRawResponse, TRawStream, TExtra>

  /** Compile the profile into the public Crux adapter factory. */
  createFor<TClient>(
    bind: (client: TClient) => NativeProviderPort<TRequest, TRawResponse, TRawStream>,
    ...deps: NativeProviderDepsArg<TDeps>
  ): (client: TClient) => CruxAdapter<TClient, TRawResponse, TRawStream, TExtra>

  /** Create lightweight helpers from the same request/response profile. */
  helpers<TClient>(
    bind: (client: TClient) => NativeProviderPort<TRequest, TRawResponse, TRawStream>,
    ...deps: NativeProviderDepsArg<TDeps>
  ): NativeChatHelpers<TClient>
}
