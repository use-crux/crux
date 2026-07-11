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

import type { SingleTurnProviderRuntimeSpec } from "./single-turn-types";
import type { LoopOwnedProviderRuntimeSpec } from "./loop-owned-types";
import type { ProviderCompletedOperationFactory } from "./completed-operations";

export type {
  DefinedProviderRuntime,
  DefinedSingleTurnProviderRuntime,
  LoopOwnedProviderRuntime,
  ProviderGenerationRuntime,
  ProviderOwnership,
  ProviderRuntimeDepsArg,
  ProviderRuntimeKind,
  SingleTurnProviderRuntime,
} from "./runtime-types";
export type {
  ProviderCompletedOperationFactories,
  ProviderCompletedOperationFactory,
} from "./completed-operations";
export type {
  SingleTurnProviderRuntimeSpec,
  SingleTurnRuntimeContract,
} from "./single-turn-types";
export type {
  DefinedSingleTurnProviderBundle,
  SingleTurnProviderBundleDeps,
  SingleTurnProviderBundleSpec,
} from "./single-turn-bundle-types";
export type {
  LoopOwnedProviderRuntimeSpec,
  LoopOwnedRuntimeBindContext,
  LoopOwnedRuntimeContract,
} from "./loop-owned-types";

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
      object,
      ProviderCompletedOperationFactory<unknown> | undefined,
      ProviderCompletedOperationFactory<unknown> | undefined,
      ProviderCompletedOperationFactory<unknown> | undefined
    >
  | LoopOwnedProviderRuntimeSpec<
      unknown,
      unknown,
      unknown,
      unknown,
      object,
      ProviderCompletedOperationFactory<unknown> | undefined,
      ProviderCompletedOperationFactory<unknown> | undefined,
      ProviderCompletedOperationFactory<unknown> | undefined
    >;
