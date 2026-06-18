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
  DefinedProviderRuntime,
  DefinedSingleTurnProviderRuntime,
  LoopOwnedProviderSpec,
  LoopOwnedProviderRuntimeSpec,
  ProviderRuntimeSpec,
  SingleTurnProviderSpec,
  SingleTurnProviderRuntimeSpec,
} from './types'
