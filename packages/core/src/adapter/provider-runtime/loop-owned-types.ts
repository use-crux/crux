/**
 * Loop-owned provider runtime contracts.
 *
 * @module
 */

import type { ModelInfo } from "../../types";
import type { GenerationSettings } from "../../generation/types";
import type { BoundLoopRuntime } from "../loop-runtime-port";
import type { StructuredOutputCapabilities } from "../structured-output";
import type { ProviderRuntimeExtender } from "./extension-types";
import type { LoopOwnedProviderRuntime } from "./runtime-types";
import type { ProviderMediaHooks } from "../native-chat/media-hooks";
import type {
  DefinedCompletedOperations,
  ProviderCompletedOperationFactories,
  ProviderCompletedOperationFactory,
} from "./completed-operations";
import type {
  DefinedStreamingOperations,
  ProviderStreamingOperationFactories,
} from "./streaming-operations";

/** Context passed when binding a loop-owned runtime to a concrete client. */
export interface LoopOwnedRuntimeBindContext {
  /** Stable provider runtime id. */
  readonly id: string;
}

/**
 * Loop-owned runtime contract accepted by `defineProviderRuntime()`.
 *
 * Use this branch for SDKs that own the multi-step generation loop while
 * Crux steers policy around that loop boundary. The Vercel AI SDK adapter
 * is the canonical example. `bind` returns the client-dependent operations
 * ({@link BoundLoopRuntime}); core assembles them with `describeModel` and
 * `settings` into the full {@link LoopRuntimePort}.
 */
export interface LoopOwnedRuntimeContract<
  TClient,
  TModel,
  TRawResponse = unknown,
  TRawStream = unknown,
> {
  /** Extract provider/model identity from an SDK model reference. */
  describeModel?: (model: TModel) => ModelInfo;
  /** Map canonical generation settings to SDK-native option names. */
  settings?: (
    settings: GenerationSettings,
    model: ModelInfo,
  ) => Record<string, unknown>;
  /** Provider-authored media validation consumed privately before SDK I/O. */
  media?: ProviderMediaHooks;
  /**
   * Resolve the inert structured-output capabilities a selected model accepts,
   * or `undefined` when its semantics cannot be guaranteed. Core compiles the
   * wire schema from the result; this resolver never compiles or rewrites.
   */
  structuredOutput?: {
    capabilities(model: ModelInfo): StructuredOutputCapabilities | undefined;
  };
  /** Bind a concrete SDK client to the SDK-owned generation loop. */
  bind(
    client: TClient,
    ctx: LoopOwnedRuntimeBindContext,
  ): BoundLoopRuntime<TModel, TRawResponse, TRawStream>;
}

/** Provider runtime spec for the loop-owned branch. */
export interface LoopOwnedProviderRuntimeSpec<
  TClient,
  TModel,
  TRawResponse = unknown,
  TRawStream = unknown,
  TExtensions extends object = Record<never, never>,
  TImage extends ProviderCompletedOperationFactory<TClient> | undefined =
    undefined,
  TTranscription extends
    | ProviderCompletedOperationFactory<TClient>
    | undefined = undefined,
  TSpeech extends ProviderCompletedOperationFactory<TClient> | undefined =
    undefined,
  TStreaming extends ProviderStreamingOperationFactories<TClient> | undefined =
    undefined,
> extends ProviderCompletedOperationFactories<
  TClient,
  TImage,
  TTranscription,
  TSpeech
> {
  /** Stable id used in metadata, observability, and provider matching. */
  readonly id: string;
  /**
   * Declares that an upstream SDK owns the model/tool loop while Crux owns
   * policy around the loop boundary.
   *
   * Existing specs may omit this during migration; core infers `'loop-owned'`
   * from the `loop` contract.
   */
  readonly ownership?: "loop-owned";
  /** Loop-owned SDK mechanics. */
  readonly loop: LoopOwnedRuntimeContract<
    TClient,
    TModel,
    TRawResponse,
    TRawStream
  >;
  /** Genuine bounded media streams. Omit unsupported operations. */
  readonly streaming?: TStreaming;
  /** Provider-specific capabilities to expose next to generation. */
  readonly extend?: ProviderRuntimeExtender<
    TClient,
    LoopOwnedProviderRuntime<TClient, TModel, TRawResponse, TRawStream> &
      DefinedCompletedOperations<TImage, TTranscription, TSpeech> &
      DefinedStreamingOperations<TStreaming>,
    TExtensions
  >;
  /** Disallow mixing provider runtime dialects. */
  readonly turn?: never;
}
