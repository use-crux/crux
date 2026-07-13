/**
 * Public contracts for single-turn provider runtime bundles.
 *
 * A bundle is the high-level authoring surface for provider packages where
 * Crux owns the model/tool loop and the provider owns one native SDK turn at a
 * time. It keeps provider wire hooks together, then compiles them through the
 * lower-level provider runtime contract.
 *
 * @module
 */

import type {
  NativeChatHelpers,
  NativeChatProfile,
  NativeProviderPort,
} from "../native-chat";
import type { ProviderRuntimeExtender } from "./extension-types";
import type {
  DefinedCompletedOperations,
  ProviderCompletedOperationFactories,
  ProviderCompletedOperationFactory,
} from "./completed-operations";
import type {
  DefinedSingleTurnProviderRuntime,
  ProviderRuntimeDepsArg,
  SingleTurnProviderRuntime,
} from "./runtime-types";

/**
 * Optional mappers from provider-facing factory arguments to runtime deps.
 *
 * Use these when a provider wants public factory arguments that are more
 * ergonomic than passing the native dependency object directly. For example,
 * a provider can accept `create(client, options)` while still giving core a
 * `{ cacheResolver }` dependency object.
 */
export interface SingleTurnProviderBundleDeps<
  TClient,
  TDeps extends Record<string, unknown>,
  TCreateArgs extends readonly unknown[],
  THelperArgs extends readonly unknown[],
> {
  /** Build provider-owned runtime dependencies for `create()`. */
  readonly create?: (client: TClient, ...args: [...TCreateArgs]) => TDeps;
  /** Build provider-owned helper dependencies for `helpers()`. */
  readonly helpers?: (...args: [...THelperArgs]) => TDeps;
}

/**
 * High-level single-turn provider bundle specification.
 *
 * Provider packages provide the SDK binder plus native chat profile hooks.
 * Core supplies the stable runtime shape, helper factories, ownership
 * metadata, and extension collision checks.
 */
export interface SingleTurnProviderBundleSpec<
  TClient,
  TRequest,
  TRawResponse,
  TRawStream extends AsyncIterable<unknown>,
  TExtra extends Record<string, unknown>,
  TDeps extends Record<string, unknown> = Record<string, never>,
  TProviderMessage = unknown,
  TCreateArgs extends readonly unknown[] = ProviderRuntimeDepsArg<TDeps>,
  THelperArgs extends readonly unknown[] = ProviderRuntimeDepsArg<TDeps>,
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
  /** Stable provider id used in metadata, observability, and provider matching. */
  readonly id: string;
  /** Bind a concrete provider SDK client to Crux's narrow native port. */
  readonly bind: (
    client: TClient,
  ) => NativeProviderPort<TRequest, TRawResponse, TRawStream>;
  /**
   * Provider-owned wire-format hooks.
   *
   * The bundle supplies `providerId`, so profiles stay focused on request
   * construction, response normalization, streaming, settings, schemas, and
   * transcript conversion.
   */
  readonly profile: Omit<
    NativeChatProfile<
      TRequest,
      TRawResponse,
      TRawStream,
      TExtra,
      TDeps,
      TProviderMessage
    >,
    "providerId"
  >;
  /** Optional public factory argument mappers for provider-owned dependencies. */
  readonly deps?: SingleTurnProviderBundleDeps<
    TClient,
    TDeps,
    TCreateArgs,
    THelperArgs
  >;
  /** Provider-specific capabilities to expose next to generation. */
  readonly extend?: ProviderRuntimeExtender<
    TClient,
    SingleTurnProviderRuntime<TClient, TRawResponse, TRawStream, TExtra> &
      DefinedCompletedOperations<TImage, TTranscription, TSpeech>,
    TExtensions
  >;
}

/**
 * Compiled single-turn provider bundle.
 *
 * The `runtime` property exposes the lower-level provider runtime for advanced
 * use, while `create()` and `helpers()` apply any bundle-level dependency
 * mappers before delegating to that runtime.
 */
export interface DefinedSingleTurnProviderBundle<
  TClient,
  TRawResponse,
  TRawStream extends AsyncIterable<unknown>,
  TExtra extends Record<string, unknown>,
  TDeps extends Record<string, unknown> = Record<string, never>,
  TCreateArgs extends readonly unknown[] = ProviderRuntimeDepsArg<TDeps>,
  THelperArgs extends readonly unknown[] = ProviderRuntimeDepsArg<TDeps>,
  TExtensions extends object = Record<never, never>,
  TImage extends ProviderCompletedOperationFactory<TClient> | undefined =
    undefined,
  TTranscription extends
    | ProviderCompletedOperationFactory<TClient>
    | undefined = undefined,
  TSpeech extends ProviderCompletedOperationFactory<TClient> | undefined =
    undefined,
> {
  /** Stable provider id used in metadata, observability, and provider matching. */
  readonly id: string;
  /** Bundle ownership is always the core-owned single-turn loop. */
  readonly ownership: "single-turn";
  /** Lower-level provider runtime compiled from this bundle. */
  readonly runtime: DefinedSingleTurnProviderRuntime<
    TClient,
    TRawResponse,
    TRawStream,
    TExtra,
    TDeps,
    TExtensions,
    DefinedCompletedOperations<TImage, TTranscription, TSpeech>
  >;
  /** Bind the compiled runtime to a provider client and public dependency args. */
  create(
    client: TClient,
    ...args: [...TCreateArgs]
  ): SingleTurnProviderRuntime<TClient, TRawResponse, TRawStream, TExtra> &
    DefinedCompletedOperations<TImage, TTranscription, TSpeech> &
    TExtensions;
  /** Create lightweight framework-agnostic generation helpers. */
  helpers(...args: [...THelperArgs]): NativeChatHelpers<TClient>;
}
