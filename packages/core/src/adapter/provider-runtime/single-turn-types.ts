/**
 * Single-turn provider runtime contracts.
 *
 * @module
 */

import type {
  NativeChatProfile as CoreNativeChatProfile,
  NativeProviderPort,
} from "../native-chat";
import type { ProviderRuntimeExtender } from "./extension-types";
import type { SingleTurnProviderRuntime } from "./runtime-types";
import type {
  DefinedCompletedOperations,
  ProviderCompletedOperationFactories,
  ProviderCompletedOperationFactory,
} from "./completed-operations";

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
> = Omit<
  CoreNativeChatProfile<
    TRequest,
    TRawResponse,
    TRawStream,
    TExtra,
    TDeps,
    TProviderMessage
  >,
  "providerId"
> & {
  /** Bind a concrete SDK client to the narrow native provider port. */
  readonly bind: (
    client: TClient,
  ) => NativeProviderPort<TRequest, TRawResponse, TRawStream>;
};

/** Provider runtime spec for the single-turn branch. */
export interface SingleTurnProviderRuntimeSpec<
  TClient,
  TRequest,
  TRawResponse,
  TRawStream extends AsyncIterable<unknown>,
  TExtra extends Record<string, unknown>,
  TDeps extends Record<string, unknown> = Record<string, never>,
  TProviderMessage = unknown,
  TExtensions extends object = Record<never, never>,
  TImage extends ProviderCompletedOperationFactory<TClient> | undefined =
    undefined,
  TTranscription extends
    | ProviderCompletedOperationFactory<TClient>
    | undefined = undefined,
  TSpeech extends ProviderCompletedOperationFactory<TClient> | undefined =
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
   * Declares that Crux owns the model/tool loop and the provider SDK handles
   * one raw model turn at a time.
   *
   * Existing specs may omit this during migration; core infers
   * `'single-turn'` from the `turn` contract.
   */
  readonly ownership?: "single-turn";
  /** Single-turn provider SDK mechanics. */
  readonly turn: SingleTurnRuntimeContract<
    TClient,
    TRequest,
    TRawResponse,
    TRawStream,
    TExtra,
    TDeps,
    TProviderMessage
  >;
  /** Provider-specific capabilities to expose next to generation. */
  readonly extend?: ProviderRuntimeExtender<
    TClient,
    SingleTurnProviderRuntime<TClient, TRawResponse, TRawStream, TExtra> &
      DefinedCompletedOperations<TImage, TTranscription, TSpeech>,
    TExtensions
  >;
  /** Disallow mixing provider runtime dialects. */
  readonly loop?: never;
}
