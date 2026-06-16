/**
 * Internal dialect contracts for adapter execution.
 *
 * Dialects normalize the public `AdapterSpec` and `ExecutorSpec` shapes before
 * they enter the shared execution session. They describe provider mechanics,
 * not Crux policy.
 *
 * @internal
 * @module
 */

import type { z } from 'zod'
import type { GenerationSettings, ModelInfo } from '../../types'
import type { Message } from '../../messages'
import type { ExecutorSpec } from '../executor-spec'
import type { AdapterResponse, CallArgs, StreamHandle, ToolResultEntry } from '../types'
import type {
  ExecutorOutcome,
  ExecutorRequest,
  ExecutorStreamHandle,
  StructuredAttempt,
  StructuredRequest,
} from '../executor-types'

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
) => Message[]

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
 */
export interface CoreStepDialect<
  TClient,
  TRawResponse,
  TRawStream,
  TExtra extends Record<string, unknown> = Record<string, unknown>,
> {
  /** Discriminant for the Crux-driven step loop. */
  readonly kind: 'core-step'

  /** Provider identifier used for adaptation, tracing, and defaults. */
  readonly id: string

  /** Client bound by the public adapter factory. */
  readonly client: TClient

  /** Convert canonical generation settings to provider-native parameters. */
  mapSettings(settings: GenerationSettings): Record<string, unknown>

  /** Execute exactly one provider call and return its normalized extraction. */
  call(client: TClient, args: CallArgs<TExtra>): Promise<{ raw: TRawResponse; extracted: AdapterResponse }>

  /** Start one provider stream using fully prepared Crux call arguments. */
  stream(client: TClient, args: CallArgs<TExtra>): Promise<StreamHandle<TRawStream>>

  /** Format the assistant response and tool results for the next provider call. */
  appendToolRound: AppendToolRound

  /** Optionally adapt tool JSON Schema before it reaches the provider. */
  sanitizeToolSchema?: (schema: Record<string, unknown>) => Record<string, unknown>

  /** Optionally wrap a Zod output schema into provider-native structured output params. */
  wrapOutputSchema?: (schema: z.ZodType) => Record<string, unknown>
}

/**
 * Normalized dialect for `ExecutorSpec` implementations.
 *
 * Use this dialect when an SDK owns the multi-step loop, such as the Vercel AI
 * SDK. Crux still owns policy around the loop: prompt resolution, tool
 * approval, validation retry, safety, cache/orchestration middleware, and
 * trace metadata.
 *
 * @typeParam TClient - SDK client or gateway object.
 * @typeParam TModel - SDK-native model reference.
 * @typeParam TRawResponse - SDK result returned from non-streaming calls.
 * @typeParam TRawStream - SDK stream result returned from streaming calls.
 */
export interface SdkLoopDialect<TClient, TModel, TRawResponse, TRawStream> {
  /** Discriminant for the SDK-owned loop. */
  readonly kind: 'sdk-loop'

  /** Executor identifier used for tracing and fallback classification. */
  readonly id: string

  /** Client bound by the public executor factory. */
  readonly client: TClient

  /** Extract provider/model identity from the SDK-native model reference. */
  describeModel(model: TModel): ModelInfo

  /** Convert canonical generation settings to SDK-native parameters. */
  mapSettings(settings: GenerationSettings, model: ModelInfo): Record<string, unknown>

  /** Run the SDK's text/tool loop with Crux-provided step observation. */
  runLoop(client: TClient, request: ExecutorRequest<TModel>): Promise<ExecutorOutcome<TRawResponse>>

  /** Make exactly one structured-output attempt; schema failures return `invalid`. */
  attemptStructured(client: TClient, request: StructuredRequest<TModel>): Promise<StructuredAttempt<TRawResponse>>

  /** Start the SDK's streaming flow with a fully prepared request. */
  runStream(
    client: TClient,
    request: ExecutorRequest<TModel> & { readonly schema?: z.ZodType },
  ): Promise<ExecutorStreamHandle<TRawStream>>

  /** Recreate a stream from cached middleware output when the SDK supports replay. */
  replayStream?: ExecutorSpec<TClient, TModel, TRawResponse, TRawStream>['replayStream']
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
> =
  | CoreStepDialect<TClient, TRawResponse, TRawStream, TExtra>
  | SdkLoopDialect<TClient, TModel, TRawResponse, TRawStream>
