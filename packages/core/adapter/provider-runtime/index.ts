/**
 * `@crux/core/adapter/provider-runtime` — provider runtime authoring.
 *
 * @module
 */

export { defineProviderRuntime } from './define'
export type {
  ProviderRuntimeExtension,
  ProviderRuntimeExtensionCollisionKeys,
  ProviderRuntimeExtensionContext,
  ProviderRuntimeExtender,
} from './extension-types'
export type {
  BoundLoopOwnedRuntime,
  DefinedProviderRuntime,
  DefinedSingleTurnProviderRuntime,
  LoopOwnedProviderRuntime,
  LoopOwnedProviderRuntimeSpec,
  LoopOwnedRuntimeBindContext,
  LoopOwnedRuntimeContract,
  ProviderOwnership,
  ProviderRuntimeKind,
  ProviderRuntimeSpec,
  SingleTurnRuntimeContract,
  SingleTurnProviderRuntimeSpec,
} from './types'
