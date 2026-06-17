/**
 * Shared public types for adapter profiles.
 *
 * Adapter profiles are the authoring layer above Crux's `AdapterSpec` and
 * `ExecutorSpec` execution IR. A profile chooses one driver shape, supplies a
 * stable id, and gets back a runtime factory.
 *
 * @module
 */

import type { ModelInfo } from '../../types'
import type { CruxAdapter } from '../define-adapter'
import type { CruxExecutor } from '../define-executor'

/** Dependency argument shape for profile factories. */
export type AdapterProfileDepsArg<TDeps extends Record<string, unknown>> =
  TDeps extends Record<string, never> ? readonly [deps?: TDeps] : readonly [deps: TDeps]

/**
 * Runtime surface produced by adapter profiles.
 *
 * Concrete drivers return the existing runtime type for their dialect:
 * native-chat profiles return `CruxAdapter`, while SDK-loop profiles return
 * `CruxExecutor`. This union is useful for documentation and generic
 * profile registries; direct `defineAdapterProfile()` calls preserve the
 * more specific driver runtime type.
 */
export type CruxGenerationRuntime<
  TModel,
  TRawResponse = unknown,
  TRawStream = unknown,
  TExtra extends Record<string, unknown> = Record<string, unknown>,
> = CruxAdapter<unknown, TRawResponse, TRawStream, TExtra> | CruxExecutor<unknown, TModel, TRawResponse, TRawStream>

/** Model identity context shared with profile drivers. */
export interface AdapterProfileContext<TModel> {
  /** Stable profile id used in traces, metadata, and provider matching. */
  readonly id: string
  /** Optional model identity extractor for SDK model objects. */
  readonly describeModel?: (model: TModel) => ModelInfo
}

/**
 * A compiled profile driver.
 *
 * Drivers are thin compilers from a public authoring shape into Crux's
 * existing execution factories. They do not own policy or tool lifecycle
 * behavior; those remain in `adapter()` and `executorAdapter()`.
 */
export interface AdapterDriver<
  TClient,
  TModel,
  TRawResponse = unknown,
  TRawStream = unknown,
  TExtra extends Record<string, unknown> = Record<string, unknown>,
  TDeps extends Record<string, unknown> = Record<string, never>,
  TRuntime = CruxGenerationRuntime<TModel, TRawResponse, TRawStream, TExtra>,
> {
  /** Driver kind, useful for diagnostics and profile registries. */
  readonly kind: 'native-chat' | 'sdk-loop'
  /** Bind this driver to a client and optional provider-owned dependencies. */
  create(ctx: AdapterProfileContext<TModel>, client: TClient, ...depsArg: AdapterProfileDepsArg<TDeps>): TRuntime
}

/**
 * Public adapter profile definition.
 *
 * A profile contains the stable id and exactly one driver. `describeModel`
 * is required only for SDK-loop runtimes whose model identity is not
 * recoverable from a simple string.
 */
export interface AdapterProfile<
  TClient,
  TModel = string,
  TRawResponse = unknown,
  TRawStream = unknown,
  TExtra extends Record<string, unknown> = Record<string, unknown>,
  TDeps extends Record<string, unknown> = Record<string, never>,
  TRuntime = CruxGenerationRuntime<TModel, TRawResponse, TRawStream, TExtra>,
> {
  /** Stable id used in metadata, observability, and provider matching. */
  readonly id: string
  /** Optional SDK model identity extractor. */
  readonly describeModel?: (model: TModel) => ModelInfo
  /** Driver compiler for this profile's runtime shape. */
  readonly driver: AdapterDriver<TClient, TModel, TRawResponse, TRawStream, TExtra, TDeps, TRuntime>
}

/** Profile factory returned by `defineAdapterProfile()`. */
export interface DefinedAdapterProfile<
  TClient,
  TModel = string,
  TRawResponse = unknown,
  TRawStream = unknown,
  TExtra extends Record<string, unknown> = Record<string, unknown>,
  TDeps extends Record<string, unknown> = Record<string, never>,
  TRuntime = CruxGenerationRuntime<TModel, TRawResponse, TRawStream, TExtra>,
> {
  /** Stable profile id. */
  readonly id: string
  /** Bind the profile to a client and optional provider-owned dependencies. */
  create(client: TClient, ...depsArg: AdapterProfileDepsArg<TDeps>): TRuntime
}
