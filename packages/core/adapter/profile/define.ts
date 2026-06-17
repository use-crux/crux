/**
 * Public adapter profile factory.
 *
 * @module
 */

import type { AdapterProfile, AdapterProfileDepsArg, CruxGenerationRuntime, DefinedAdapterProfile } from './types'

/**
 * Define a public adapter profile.
 *
 * The returned factory is intentionally tiny: it freezes the public id and
 * delegates runtime creation to the selected driver. Drivers compile into
 * Crux's existing `adapter()` or `executorAdapter()` execution paths, so
 * profile authors get a clearer surface without a second policy engine.
 *
 * @param profile - Profile id, optional model description, and driver.
 * @returns A frozen profile factory with a client-bound `create()` method.
 *
 * @example
 * ```ts
 * const openaiProfile = defineAdapterProfile({
 *   id: 'openai',
 *   driver: nativeChat({ bind, request, response, stream, settings }),
 * })
 *
 * export const createOpenAI = openaiProfile.create
 * ```
 */
export function defineAdapterProfile<
  TClient,
  TModel = string,
  TRawResponse = unknown,
  TRawStream = unknown,
  TExtra extends Record<string, unknown> = Record<string, unknown>,
  TDeps extends Record<string, unknown> = Record<string, never>,
  TRuntime = CruxGenerationRuntime<TModel, TRawResponse, TRawStream, TExtra>,
>(
  profile: AdapterProfile<TClient, TModel, TRawResponse, TRawStream, TExtra, TDeps, TRuntime>,
): DefinedAdapterProfile<TClient, TModel, TRawResponse, TRawStream, TExtra, TDeps, TRuntime> {
  return Object.freeze({
    id: profile.id,
    create(client: TClient, ...depsArg: AdapterProfileDepsArg<TDeps>): TRuntime {
      return profile.driver.create(
        {
          id: profile.id,
          describeModel: profile.describeModel,
        },
        client,
        ...depsArg,
      )
    },
  })
}
