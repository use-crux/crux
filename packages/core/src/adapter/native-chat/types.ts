/**
 * Public contracts for single-turn provider runtimes.
 *
 * A single-turn provider spec describes provider wire facts, while Crux keeps owning
 * prompt resolution, safety, tool execution, validation retry, and tracing.
 *
 * @module
 */

import type { z } from 'zod'
import type { GenerateObjectFn, GenerateTextFn } from '../../compaction'
import type { Message } from '../../generation/messages'
import type { GenerationSettings, TraceMeta } from '../../generation/types'
import type { MessageContent } from '../../types/content'
import type { CruxAdapter } from '../define-adapter'
import type { AdapterSpec } from '../spec'
import type { AdapterResponse, CallArgs, ToolResultEntry } from '../types'

/** Native call surface selected from canonical Crux call arguments. */
export type NativeCallMode = 'text' | 'structured'

/** Assistant transcript data that participates in Crux tool-loop semantics. */
export interface NativeAssistantTurn extends Pick<AdapterResponse, 'text' | 'toolCalls'> {
  /** Canonical assistant content when the provider response included media; `text` remains the envelope projection. */
  readonly content?: MessageContent
}

/** Response metadata that is independent from assistant transcript content. */
export type NativeResponseMetadata = Omit<AdapterResponse, 'text' | 'toolCalls'>

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
 * Provider-owned transcript codec for one native chat SDK.
 *
 * The transcript owns every provider-specific wire concern for history and
 * assistant turns: role names, function/tool block shapes, synthesized tool-call
 * ids, rich tool-result rendering, and provider-native message conversion.
 * Core only composes the result into request assembly and tool-loop semantics.
 *
 * @typeParam TProviderMessage - Provider-native message shape accepted by the SDK.
 * @typeParam TRawResponse - Provider-native non-streaming response shape.
 */
export interface NativeTranscriptCodec<TProviderMessage = unknown, TRawResponse = unknown> {
  /** Convert canonical Crux messages into provider-native chat messages. */
  fromMessages(
    messages: readonly Message[],
    options?: { readonly unsupportedContent?: NonNullable<GenerationSettings['unsupportedContent']> },
  ): readonly TProviderMessage[]
  /** Convert provider-native chat messages back into canonical Crux messages. */
  toMessages(messages: readonly unknown[]): Message[]
  /** Read assistant text and tool-call intent from a provider-native response. */
  readAssistant(raw: TRawResponse): NativeAssistantTurn
  /**
   * Optional provider-specific canonical tool-round append.
   *
   * Most providers can use `appendNativeToolRound()`. Override only when the
   * provider needs different canonical history before the next transcript
   * encoding pass.
   */
  appendToolRound?(
    history: readonly Message[],
    assistant: NativeAssistantTurn,
    results: readonly ToolResultEntry[],
  ): Message[]
}

/**
 * Response-level normalization for data that is not transcript-owned.
 *
 * `meta()` reads usage, finish reason, response id, and actual model id.
 * `text()` may override transcript text when the SDK exposes parsed structured
 * output separately from the assistant message content.
 */
export interface NativeResponseMapper<TRawResponse> {
  /** Read response metadata that does not belong to transcript conversion. */
  meta(raw: TRawResponse): NativeResponseMetadata
  /** Optionally override assistant text, for example with parsed JSON output. */
  text?(raw: TRawResponse, assistant: NativeAssistantTurn): string
}

/** Call arguments enriched with provider-native messages from the transcript. */
export interface NativeChatRequestArgs<
  TExtra extends Record<string, unknown>,
  TProviderMessage = unknown,
> extends CallArgs<TExtra> {
  /** Provider-native messages produced by `transcript.fromMessages()`. */
  readonly providerMessages: readonly TProviderMessage[]
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
 * Keep this spec focused on provider wire facts: request assembly, raw
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
  TProviderMessage = unknown,
> {
  /** Stable provider identifier used in traces and adapter matching. */
  readonly providerId: string

  /** Build a provider-native request from canonical Crux call arguments. */
  request(
    args: NativeChatRequestArgs<TExtra, TProviderMessage>,
    ctx: NativeChatRequestContext<TDeps>,
  ): TRequest | Promise<TRequest>

  /**
   * Normalize a provider-native response.
   *
   * The mapper owns metadata only. Assistant text and tool-call extraction
   * stay in `transcript.readAssistant()`.
   */
  response: NativeResponseMapper<TRawResponse>

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
  readonly transcript: NativeTranscriptCodec<TProviderMessage, TRawResponse>

  /** Optional provider-specific tool-round transcript append. */
  appendToolRound?(
    messages: readonly Message[],
    assistant: NativeAssistantTurn,
    results: readonly ToolResultEntry[],
  ): Message[]
}

/** Dependency argument shape: required only when the profile declares deps. */
export type NativeProviderDepsArg<TDeps extends Record<string, unknown>> =
  TDeps extends Record<string, never> ? readonly [deps?: TDeps] : readonly [deps: TDeps]

/** Bound helper functions generated from the same single-turn provider path. */
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
  TProviderMessage = unknown,
> {
  /** Original provider recipe. */
  readonly profile: NativeChatProfile<TRequest, TRawResponse, TRawStream, TExtra, TDeps, TProviderMessage>

  /** Compile the profile into an `AdapterSpec` for a provider SDK client. */
  specFor<TClient>(
    bind: (client: TClient) => NativeProviderPort<TRequest, TRawResponse, TRawStream>,
    ...deps: NativeProviderDepsArg<TDeps>
  ): AdapterSpec<TClient, TRawResponse, TRawStream, TExtra, TRequest>

  /** Compile the profile into the public Crux adapter factory. */
  createFor<TClient>(
    bind: (client: TClient) => NativeProviderPort<TRequest, TRawResponse, TRawStream>,
    ...deps: NativeProviderDepsArg<TDeps>
  ): (client: TClient) => CruxAdapter<TClient, TRawResponse, TRawStream, TExtra, TRequest>

  /** Create lightweight helpers from the same request/response profile. */
  helpers<TClient>(
    bind: (client: TClient) => NativeProviderPort<TRequest, TRawResponse, TRawStream>,
    ...deps: NativeProviderDepsArg<TDeps>
  ): NativeChatHelpers<TClient>
}
