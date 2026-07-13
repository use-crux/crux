/**
 * Internal dialect contracts for adapter execution.
 *
 * Dialects normalize the public `AdapterSpec` and `LoopRuntimePort` shapes
 * before they enter the shared execution session. They describe provider
 * mechanics, not Crux policy.
 *
 * @internal
 * @module
 */

import type { z } from "zod";
import type { GenerationSettings } from "../../generation/types";
import type { Message } from "../../generation/messages";
import type { LoopRuntimePort } from "../loop-runtime-port";
import type { ProviderMediaHooks } from '../native-chat/media-hooks'
import type {
  AdapterResponse,
  CallArgs,
  StreamHandle,
  ToolResultEntry,
} from "../types";
import type { CruxProviderError } from "../normalized-outcome";

/** Per-call context passed to provider wire hooks. */
export interface CoreStepCallContext {
  /** Cooperative abort signal for the current provider step. */
  readonly signal: AbortSignal | undefined;
}

/**
 * Append an assistant/tool result round in the format expected by a provider.
 *
 * Raw provider adapters need this hook because each SDK represents tool calls
 * and tool results differently. The execution session uses it only when it has
 * to continue a conversation after validation or tool execution.
 */
export type AppendToolRound = (
  messages: Message[],
  assistantResponse: AdapterResponse,
  toolResults: ToolResultEntry[],
) => Message[];

/**
 * Normalized dialect for `AdapterSpec` implementations.
 *
 * Use this dialect when Crux owns the loop and calls the provider one step at
 * a time. The provider supplies only mechanical hooks: map settings, make one
 * call, start one stream, and format tool rounds for its message protocol.
 *
 * @typeParam TClient - Provider SDK client or gateway object.
 * @typeParam TRawResponse - Provider response returned from non-streaming calls.
 * @typeParam TRawStream - Provider stream object returned from streaming calls.
 * @typeParam TExtra - Provider-specific per-call options.
 * @typeParam TParams - Provider-native non-streaming request params.
 */
export interface CoreStepDialect<
  TClient,
  TRawResponse,
  TRawStream,
  TExtra extends Record<string, unknown> = Record<string, unknown>,
  TParams = unknown,
> {
  /** Discriminant for the Crux-driven step loop. */
  readonly kind: "core-step";

  /** Provider identifier used for adaptation, tracing, and defaults. */
  readonly id: string;

  /** Compiler-private provider media hooks. */
  readonly media?: ProviderMediaHooks;

  /** Client bound by the public adapter factory. */
  readonly client: TClient;

  /** Convert canonical generation settings to provider-native parameters. */
  mapSettings(settings: GenerationSettings): Record<string, unknown>;

  /** Provider-specific classifier for thrown SDK errors, when supplied. */
  mapError?: (error: unknown) => CruxProviderError | undefined;

  /** Execute exactly one provider call and return its normalized extraction. */
  call(
    client: TClient,
    args: CallArgs<TExtra>,
    context?: CoreStepCallContext,
  ): Promise<{ raw: TRawResponse; extracted: AdapterResponse }>;

  /** Start one provider stream using fully prepared Crux call arguments. */
  stream(
    client: TClient,
    args: CallArgs<TExtra>,
    context?: CoreStepCallContext,
  ): Promise<StreamHandle<TRawStream>>;

  /** Translate canonical call args into provider-native params for public codecs and handles. */
  toParams?: (args: CallArgs<TExtra>) => TParams | Promise<TParams>;

  /** Normalize a provider-native response supplied to a call handle. */
  fromResponse?: (response: TRawResponse) => AdapterResponse;

  /** Format the assistant response and tool results for the next provider call. */
  appendToolRound: AppendToolRound;

  /** Optionally adapt tool JSON Schema before it reaches the provider. */
  sanitizeToolSchema?: (
    schema: Record<string, unknown>,
  ) => Record<string, unknown>;

  /** Optionally wrap a Zod output schema into provider-native structured output params. */
  wrapOutputSchema?: (schema: z.ZodType) => Record<string, unknown>;
}

/**
 * Normalized dialect for `LoopRuntimePort` implementations.
 *
 * Use this dialect when an SDK owns the multi-step loop, such as the Vercel AI
 * SDK. It is the bound {@link LoopRuntimePort} tagged with a discriminant: the
 * SDK client is already closed over, so the run methods take only requests.
 * Crux still owns policy around the loop: prompt resolution, tool approval,
 * validation retry, safety, cache/orchestration middleware, and trace metadata.
 *
 * @typeParam TModel - SDK-native model reference.
 * @typeParam TRawResponse - SDK result returned from non-streaming calls.
 * @typeParam TRawStream - SDK stream result returned from streaming calls.
 */
export interface SdkLoopDialect<
  TModel,
  TRawResponse,
  TRawStream,
> extends LoopRuntimePort<TModel, TRawResponse, TRawStream> {
  /** Discriminant for the SDK-owned loop. */
  readonly kind: "sdk-loop";
}

/**
 * Dialect accepted by the shared adapter execution session.
 *
 * The discriminant decides whether a concrete run uses the Crux-owned
 * step loop (`core-step`) or delegates the loop to an SDK (`sdk-loop`).
 */
export type AdapterExecutionDialect<
  TClient,
  TModel,
  TRawResponse,
  TRawStream,
  TExtra extends Record<string, unknown> = Record<string, unknown>,
  TParams = unknown,
> =
  | CoreStepDialect<TClient, TRawResponse, TRawStream, TExtra, TParams>
  | SdkLoopDialect<TModel, TRawResponse, TRawStream>;
