/**
 * Vitest describe helper for provider-runtime conformance suites.
 *
 * This wrapper keeps provider package tests terse while the behavior remains
 * in {@link providerRuntimeConformance}. It is intentionally small: package
 * authors still provide the runtime and harness explicitly.
 *
 * @module
 */

import { describe, expect, it } from 'vitest'
import type { DefinedProviderRuntime } from '../provider-runtime'
import { providerRuntimeConformance } from './provider-runtime'
import type {
  ProviderRuntimeConformanceCapabilities,
  ProviderRuntimeConformanceHarness,
  ProviderRuntimeConformanceRuntime,
} from './provider-runtime-types'

/** Options for {@link describeCruxAdapterConformance}. */
export interface DescribeCruxAdapterConformanceOptions<
  TClient,
  TModel = string,
  TRawResponse = unknown,
  TRawStream = unknown,
  TExtra extends Record<string, unknown> = Record<string, unknown>,
  TDeps extends Record<string, unknown> = Record<string, never>,
  TRuntime extends ProviderRuntimeConformanceRuntime<TModel> = ProviderRuntimeConformanceRuntime<TModel>,
  TExtensions extends object = object,
> {
  /** Human-readable provider name for the generated Vitest suite. */
  readonly name: string
  /** Public provider runtime under test. */
  readonly runtime: DefinedProviderRuntime<
    TClient,
    TModel,
    TRawResponse,
    TRawStream,
    TExtra,
    TDeps,
    TRuntime,
    TExtensions
  >
  /** Provider-owned script-to-SDK fake bridge. */
  readonly harness: ProviderRuntimeConformanceHarness<TClient, TModel, TDeps>
  /** Capability override for this suite. Defaults to `harness.capabilities`. */
  readonly capabilities?: ProviderRuntimeConformanceCapabilities
}

/**
 * Register a Vitest suite for a Crux provider runtime.
 *
 * @example
 * ```ts
 * describeCruxAdapterConformance({
 *   name: 'openai',
 *   runtime: openaiProviderRuntime,
 *   harness: openAIConformanceHarness(),
 *   capabilities: { ownership: 'single-turn', structuredOutput: true },
 * })
 * ```
 */
export function describeCruxAdapterConformance<
  TClient,
  TModel = string,
  TRawResponse = unknown,
  TRawStream = unknown,
  TExtra extends Record<string, unknown> = Record<string, unknown>,
  TDeps extends Record<string, unknown> = Record<string, never>,
  TRuntime extends ProviderRuntimeConformanceRuntime<TModel> = ProviderRuntimeConformanceRuntime<TModel>,
  TExtensions extends object = object,
>(
  options: DescribeCruxAdapterConformanceOptions<
    TClient,
    TModel,
    TRawResponse,
    TRawStream,
    TExtra,
    TDeps,
    TRuntime,
    TExtensions
  >,
): void {
  describe(`${options.name} provider runtime conformance`, () => {
    it('conforms to the Crux provider runtime contract', async () => {
      const harness: ProviderRuntimeConformanceHarness<TClient, TModel, TDeps> = {
        ...options.harness,
        capabilities: options.capabilities ?? options.harness.capabilities,
      }

      const violations = await providerRuntimeConformance(options.runtime, harness)
      expect(violations).toEqual([])
    })
  })
}
