/**
 * Internal execution session shared by Crux adapter factories.
 *
 * The public adapter APIs expose two provider contracts: `AdapterSpec` for
 * raw SDK calls where Crux owns each step, and `ExecutorSpec` for SDKs that
 * own their own loop. This module normalizes both contracts behind one
 * session so prompt resolution, tool lifecycle, validation retry, safety,
 * orchestration, timeout cleanup, metadata stamping, and memory capture stay
 * in one place.
 *
 * Adapter authors should keep implementing `AdapterSpec` or `ExecutorSpec`.
 * The types in this module are exported for internal composition and boundary
 * tests, not as a stable public authoring surface.
 *
 * @internal
 * @module
 */

import type {
  AdapterExecution,
  AdapterExecutionDialect,
  AdapterExecutionGenerateArgs,
  AdapterExecutionGenerateResult,
  AdapterExecutionStreamArgs,
  AdapterExecutionStreamResult,
  CoreStepDialect,
  SdkLoopDialect,
} from './types'
import { generateCore } from './generate-core'
import { generateSdk } from './generate-sdk'
import { streamCore } from './stream-core'
import { streamSdk } from './stream-sdk'

export type {
  AdapterExecution,
  AdapterExecutionDialect,
  AdapterExecutionGenerateArgs,
  AdapterExecutionGenerateResult,
  AdapterExecutionStreamArgs,
  AdapterExecutionStreamResult,
  AppendToolRound,
  CoreStepDialect,
  SdkLoopDialect,
} from './types'
export { coreStepDialect, sdkLoopDialect } from './dialects'

/**
 * Create a shared execution facade for a core-step dialect.
 *
 * @param dialect - Normalized Crux-owned loop dialect.
 * @returns A frozen execution facade bound to the dialect's client.
 *
 * @internal
 */
export function createAdapterExecution<
  TClient,
  TRawResponse,
  TRawStream,
  TExtra extends Record<string, unknown> = Record<string, unknown>,
>(
  dialect: CoreStepDialect<TClient, TRawResponse, TRawStream, TExtra>,
): AdapterExecution<string, TRawResponse, TRawStream, TExtra>

/**
 * Create a shared execution facade for an SDK-loop dialect.
 *
 * @param dialect - Normalized SDK-owned loop dialect.
 * @returns A frozen execution facade bound to the dialect's client.
 *
 * @internal
 */
export function createAdapterExecution<TClient, TModel, TRawResponse, TRawStream>(
  dialect: SdkLoopDialect<TClient, TModel, TRawResponse, TRawStream>,
): AdapterExecution<TModel, TRawResponse, TRawStream, Record<string, unknown>>

export function createAdapterExecution<
  TClient,
  TModel,
  TRawResponse,
  TRawStream,
  TExtra extends Record<string, unknown> = Record<string, unknown>,
>(
  dialect: AdapterExecutionDialect<TClient, TModel, TRawResponse, TRawStream, TExtra>,
): AdapterExecution<TModel, TRawResponse, TRawStream, TExtra> {
  async function generate(
    args: AdapterExecutionGenerateArgs<TModel, TExtra>,
  ): Promise<AdapterExecutionGenerateResult<TRawResponse>> {
    if (dialect.kind === 'core-step') {
      return generateCore(dialect, args as AdapterExecutionGenerateArgs<string, TExtra>)
    }
    return generateSdk(dialect, args as AdapterExecutionGenerateArgs<TModel, Record<string, unknown>>)
  }

  async function stream(
    args: AdapterExecutionStreamArgs<TModel, TExtra>,
  ): Promise<AdapterExecutionStreamResult<TRawStream>> {
    if (dialect.kind === 'core-step') {
      return streamCore(dialect, args as AdapterExecutionStreamArgs<string, TExtra>)
    }
    return streamSdk(dialect, args as AdapterExecutionStreamArgs<TModel, Record<string, unknown>>)
  }

  return Object.freeze({ generate, stream })
}
