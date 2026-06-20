/**
 * Provider runtime compiler.
 *
 * @module
 */

import { defineNativeChatProvider } from '../native-chat'
import { createLoopOwnedProviderRuntime } from './loop-compiler'
import { createDefinedProviderRuntime } from './runtime-factory'
import type {
  DefinedProviderRuntime,
  DefinedSingleTurnProviderRuntime,
  LoopOwnedProviderRuntime,
  LoopOwnedProviderRuntimeSpec,
  ProviderRuntimeDepsArg,
  ProviderRuntimeSpec,
  SingleTurnProviderRuntime,
  SingleTurnProviderRuntimeSpec,
} from './types'

/**
 * Define a Crux provider runtime from single-turn provider mechanics.
 *
 * This is the preferred public authoring surface for provider packages that
 * expose one raw SDK call or stream per model turn. Core compiles the spec
 * into the same runtime used by `adapter()`, so prompt resolution, tool
 * lifecycle, validation retry, safety, observability, and memory capture
 * stay centralized.
 *
 * @param spec - Provider id plus `turn` SDK mechanics.
 * @returns A frozen provider runtime.
 *
 * @example
 * ```ts
 * const openai = defineProviderRuntime({
 *   id: 'openai',
 *   turn: {
 *     bind: bindOpenAI,
 *     request: openAIRequest,
 *     response: { meta: openAIResponseMeta, text: openAIResponseText },
 *     stream: { request: openAIStreamRequest, textDelta: openAITextDelta },
 *     settings: openAISettings,
 *     outputSchema: openAIOutputSchema,
 *     transcript: openAITranscript,
 *   },
 * })
 *
 * export const createOpenAI = openai.create
 * ```
 */
export function defineProviderRuntime<
  TClient,
  TRequest,
  TRawResponse,
  TRawStream extends AsyncIterable<unknown>,
  TExtra extends Record<string, unknown>,
  TDeps extends Record<string, unknown> = Record<string, never>,
  TProviderMessage = unknown,
  TExtensions extends object = Record<string, never>,
>(
  spec: SingleTurnProviderRuntimeSpec<
    TClient,
    TRequest,
    TRawResponse,
    TRawStream,
    TExtra,
    TDeps,
    TProviderMessage,
    TExtensions
  >,
): DefinedSingleTurnProviderRuntime<TClient, TRawResponse, TRawStream, TExtra, TDeps, TExtensions>

/**
 * Define a Crux provider runtime from loop-owned SDK mechanics.
 *
 * Use this branch for SDKs, such as the Vercel AI SDK, that own the
 * multi-step model/tool loop. The SDK remains outside `@crux/core`; core
 * receives only structural hooks and compiles them into the existing
 * executor runtime.
 *
 * @param spec - Provider id plus `loop.bind()` SDK mechanics.
 * @returns A frozen provider runtime.
 */
export function defineProviderRuntime<
  TClient,
  TModel,
  TRawResponse = unknown,
  TRawStream = unknown,
  TExtensions extends object = Record<string, never>,
>(
  spec: LoopOwnedProviderRuntimeSpec<TClient, TModel, TRawResponse, TRawStream, TExtensions>,
): DefinedProviderRuntime<
  TClient,
  TModel,
  TRawResponse,
  TRawStream,
  Record<string, unknown>,
  Record<string, never>,
  LoopOwnedProviderRuntime<TClient, TModel, TRawResponse, TRawStream>,
  TExtensions
>

export function defineProviderRuntime(
  spec: ProviderRuntimeSpec,
): DefinedProviderRuntime<
  unknown,
  unknown,
  unknown,
  unknown,
  Record<string, unknown>,
  Record<string, unknown>,
  object,
  object
> {
  const runtimeId = spec.id
  if (isSingleTurnRuntimeSpec(spec)) {
    const { bind, ...turnContract } = spec.turn
    const provider = defineNativeChatProvider({ ...turnContract, providerId: runtimeId })

    return Object.freeze({
      ...createDefinedProviderRuntime(
        runtimeId,
        (client: unknown, ...depsArg: ProviderRuntimeDepsArg<Record<string, unknown>>) =>
          provider.createFor(bind, ...depsArg)(client),
        spec.extend,
      ),
      helpers(...depsArg: ProviderRuntimeDepsArg<Record<string, unknown>>) {
        return provider.helpers(bind, ...depsArg)
      },
    })
  }

  if (isLoopOwnedRuntimeSpec(spec)) return createLoopOwnedProviderRuntime(spec)
  throw new Error(`Provider runtime "${runtimeId}" must define either turn or loop mechanics.`)
}

type AnySingleTurnRuntimeSpec = SingleTurnProviderRuntimeSpec<
  unknown,
  unknown,
  unknown,
  AsyncIterable<unknown>,
  Record<string, unknown>,
  Record<string, unknown>,
  unknown,
  object
>

type AnyLoopOwnedRuntimeSpec = LoopOwnedProviderRuntimeSpec<unknown, unknown, unknown, unknown, object>

function isSingleTurnRuntimeSpec(spec: ProviderRuntimeSpec): spec is AnySingleTurnRuntimeSpec {
  return 'turn' in spec && spec.turn !== undefined
}

function isLoopOwnedRuntimeSpec(spec: ProviderRuntimeSpec): spec is AnyLoopOwnedRuntimeSpec {
  return 'loop' in spec && spec.loop !== undefined
}
