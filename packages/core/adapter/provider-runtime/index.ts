/**
 * `@crux/core/adapter/provider-runtime` — provider runtime authoring.
 *
 * @module
 */

export { defineProviderRuntime } from './define'
export type {
  DefinedProviderRuntime,
  DefinedSingleTurnProviderRuntime,
  LoopOwnedProviderSpec,
  LoopOwnedProviderRuntimeSpec,
  ProviderRuntimeExtensionContext,
  ProviderRuntimeExtender,
  ProviderRuntimeSpec,
  SingleTurnProviderSpec,
  SingleTurnProviderRuntimeSpec,
} from './types'
