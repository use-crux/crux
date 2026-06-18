/**
 * Public contracts for provider runtimes.
 *
 * Provider runtimes are the stable boundary between provider packages and
 * Crux-owned policy. A provider package describes only the mechanics of its
 * SDK, while core compiles those mechanics into the existing generation
 * runtime.
 *
 * @module
 */

import type { ModelInfo } from '../../types'
import type { CruxAdapter } from '../define-adapter'
import type { CruxExecutor } from '../define-executor'
import type {
  ExecutorOutcome,
  ExecutorRequest,
  ExecutorStreamHandle,
  StructuredAttempt,
  StructuredRequest,
} from '../executor-types'
import type {
  NativeChatHelpers,
  NativeChatProfile as CoreNativeChatProfile,
  NativeProviderPort,
} from '../native-chat'
import type { GenerationSettings } from '../../types'
import type { z } from 'zod'

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
  TClient,
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

/**
 * Single-turn provider mechanics.
 *
 * Use this branch for provider SDKs that expose raw chat calls and leave
 * the model/tool loop to Crux. Examples include native OpenAI, Anthropic,
 * and Google provider adapters.
 */
export type SingleTurnProviderSpec<
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

/**
 * Loop-owned provider mechanics.
 *
 * Use this branch for SDKs that own the multi-step generation loop while
 * Crux steers policy around that loop boundary. The Vercel AI SDK adapter
 * is the canonical example.
 */
export interface LoopOwnedProviderSpec<TClient, TModel, TRawResponse = unknown, TRawStream = unknown> {
  /** Extract provider/model identity from an SDK model reference. */
  describeModel?: (model: TModel) => ModelInfo
  /** Map canonical generation settings to SDK-native option names. */
  settings(settings: GenerationSettings, model: ModelInfo): Record<string, unknown>
  /** Run the SDK-owned text/tool loop. */
  runLoop(client: TClient, request: ExecutorRequest<TModel>): Promise<ExecutorOutcome<TRawResponse>>
  /** Make one structured-output attempt; invalid schema results return in-band. */
  attemptStructured(client: TClient, request: StructuredRequest<TModel>): Promise<StructuredAttempt<TRawResponse>>
  /** Start a streaming generation and return the SDK stream handle. */
  runStream(
    client: TClient,
    request: ExecutorRequest<TModel> & { readonly schema?: z.ZodType },
  ): Promise<ExecutorStreamHandle<TRawStream>>
  /** Recreate a stream handle from cached semantic-cache payloads when supported. */
  replayStream?(cached: {
    readonly text?: string
    readonly object?: unknown
    readonly meta?: Record<string, unknown>
  }): ExecutorStreamHandle<TRawStream>
}

/**
 * Context passed to a provider runtime extension factory.
 *
 * Extensions are for provider-specific capabilities that should travel
 * beside generation, such as embeddings or reranking. They do not change
 * the Crux generation runtime itself.
 */
export interface ProviderRuntimeExtensionContext<TClient, TRuntime> {
  /** Stable provider runtime id. */
  readonly id: string
  /** Client value originally passed to `create()`. */
  readonly client: TClient
  /** Core-compiled generation runtime for this provider. */
  readonly runtime: TRuntime
}

/** Creates provider-specific extensions beside the generation runtime. */
export type ProviderRuntimeExtender<TClient, TRuntime, TExtensions extends object> = (
  ctx: ProviderRuntimeExtensionContext<TClient, TRuntime>,
) => TExtensions

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
  readonly singleTurn: SingleTurnProviderSpec<
    TClient,
    TRequest,
    TRawResponse,
    TRawStream,
    TExtra,
    TDeps,
    TProviderMessage
  >
  /** Provider-specific capabilities to expose next to generation. */
  readonly extend?: ProviderRuntimeExtender<
    TClient,
    SingleTurnProviderRuntime<TClient, TRawResponse, TRawStream, TExtra>,
    TExtensions
  >
  /** Disallow mixing provider runtime dialects. */
  readonly loop?: never
}

/** Provider runtime spec for the loop-owned branch. */
export interface LoopOwnedProviderRuntimeSpec<
  TClient,
  TModel,
  TRawResponse = unknown,
  TRawStream = unknown,
  TExtensions extends object = Record<string, never>,
> {
  /** Stable id used in metadata, observability, and provider matching. */
  readonly id: string
  /** Loop-owned SDK mechanics. */
  readonly loop: LoopOwnedProviderSpec<TClient, TModel, TRawResponse, TRawStream>
  /** Provider-specific capabilities to expose next to generation. */
  readonly extend?: ProviderRuntimeExtender<
    TClient,
    LoopOwnedProviderRuntime<TClient, TModel, TRawResponse, TRawStream>,
    TExtensions
  >
  /** Disallow mixing provider runtime dialects. */
  readonly singleTurn?: never
}

/** Any public provider runtime spec. */
export type ProviderRuntimeSpec =
  | SingleTurnProviderRuntimeSpec<
      unknown,
      unknown,
      unknown,
      AsyncIterable<unknown>,
      Record<string, unknown>,
      Record<string, unknown>,
      unknown,
      object
    >
  | LoopOwnedProviderRuntimeSpec<unknown, unknown, unknown, unknown, object>

/**
 * Runtime returned by {@link defineProviderRuntime}.
 */
export interface DefinedProviderRuntime<
  TClient,
  TModel = string,
  TRawResponse = unknown,
  TRawStream = unknown,
  TExtra extends Record<string, unknown> = Record<string, unknown>,
  TDeps extends Record<string, unknown> = Record<string, never>,
  TRuntime = ProviderGenerationRuntime<TClient, TModel, TRawResponse, TRawStream, TExtra>,
  TExtensions extends object = Record<string, never>,
> {
  /** Stable provider runtime id. */
  readonly id: string
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
    TExtensions
  > {
  /** Create lightweight framework-agnostic generation helpers. */
  helpers(...depsArg: ProviderRuntimeDepsArg<TDeps>): NativeChatHelpers<TClient>
}
