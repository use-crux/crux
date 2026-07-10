/**
 * `@use-crux/core/adapter/provider-runtime` — provider runtime authoring.
 *
 * @module
 */

export { defineProviderRuntime } from './define'
export { defineSingleTurnProviderBundle } from './single-turn-bundle'
export type {
  ProviderRuntimeExtension,
  ProviderRuntimeExtensionCollisionKeys,
  ProviderRuntimeExtensionContext,
  ProviderRuntimeExtender,
} from './extension-types'
export type {
  DefinedSingleTurnProviderBundle,
  SingleTurnProviderBundleDeps,
  SingleTurnProviderBundleSpec,
} from './single-turn-bundle-types'
export type {
  DefinedProviderRuntime,
  DefinedSingleTurnProviderRuntime,
  LoopOwnedProviderRuntime,
  LoopOwnedProviderRuntimeSpec,
  LoopOwnedRuntimeBindContext,
  LoopOwnedRuntimeContract,
  ProviderOwnership,
  ProviderRuntimeDepsArg,
  ProviderRuntimeKind,
  ProviderRuntimeSpec,
  SingleTurnRuntimeContract,
  SingleTurnProviderRuntimeSpec,
} from './types'
