/**
 * Provider runtime compiler.
 *
 * @module
 */

import type { ModelInfo } from '../../types'
import { executorAdapter } from '../define-executor'
import type { ExecutorSpec } from '../executor-spec'
import { defineNativeChatProvider } from '../native-chat'
import type {
  DefinedProviderRuntime,
  DefinedSingleTurnProviderRuntime,
  LoopOwnedProviderRuntimeSpec,
  LoopOwnedProviderRuntime,
  ProviderRuntimeSpec,
  ProviderRuntimeDepsArg,
  SingleTurnProviderRuntimeSpec,
  SingleTurnProviderRuntime,
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
 * @param spec - Provider id plus `singleTurn` SDK mechanics.
 * @returns A frozen provider runtime.
 *
 * @example
 * ```ts
 * const openai = defineProviderRuntime({
 *   id: 'openai',
 *   singleTurn: {
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
 * @param spec - Provider id plus `loop` SDK mechanics.
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

export function defineProviderRuntime(spec: ProviderRuntimeSpec): DefinedProviderRuntime<
  unknown,
  unknown,
  unknown,
  unknown,
  Record<string, unknown>,
  Record<string, unknown>,
  object,
  object
> {
  if (isSingleTurnRuntimeSpec(spec)) {
    const { bind, ...singleTurn } = spec.singleTurn
    const provider = defineNativeChatProvider({
      ...singleTurn,
      providerId: spec.id,
    })

    return Object.freeze({
      ...createDefinedProviderRuntime(
        spec.id,
        (client: unknown, ...depsArg: ProviderRuntimeDepsArg<Record<string, unknown>>) =>
          provider.createFor(bind, ...depsArg)(client),
        spec.extend,
      ),
      helpers(...depsArg: ProviderRuntimeDepsArg<Record<string, unknown>>) {
        return provider.helpers(bind, ...depsArg)
      },
    })
  }

  const executorSpec: ExecutorSpec<unknown, unknown, unknown, unknown> = {
    executorId: spec.id,
    describeModel: spec.loop.describeModel ?? ((model) => describeModelFallback(spec.id, model)),
    mapSettings: spec.loop.settings,
    runLoop: spec.loop.runLoop,
    attemptStructured: spec.loop.attemptStructured,
    runStream: spec.loop.runStream,
  }

  if (spec.loop.replayStream) {
    executorSpec.replayStream = spec.loop.replayStream
  }

  return createDefinedProviderRuntime(spec.id, executorAdapter(executorSpec), spec.extend)
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

function isSingleTurnRuntimeSpec(spec: ProviderRuntimeSpec): spec is AnySingleTurnRuntimeSpec {
  return spec.singleTurn !== undefined
}

function createDefinedProviderRuntime<
  TClient,
  TModel,
  TRawResponse,
  TRawStream,
  TExtra extends Record<string, unknown>,
  TDeps extends Record<string, unknown>,
  TRuntime extends object,
  TExtensions extends object,
>(
  id: string,
  createRuntime: (client: TClient, ...depsArg: ProviderRuntimeDepsArg<TDeps>) => TRuntime,
  extend:
    | ((
        ctx: {
          readonly id: string
          readonly client: TClient
          readonly runtime: TRuntime
        },
      ) => TExtensions)
    | undefined,
): DefinedProviderRuntime<TClient, TModel, TRawResponse, TRawStream, TExtra, TDeps, TRuntime, TExtensions> {
  return Object.freeze({
    id,
    create(client: TClient, ...depsArg: ProviderRuntimeDepsArg<TDeps>) {
      const runtime = createRuntime(client, ...depsArg)
      if (!extend) return runtime as TRuntime & TExtensions

      return mergeRuntimeExtensions(id, runtime, extend({ id, client, runtime })) as TRuntime & TExtensions
    },
  })
}

/**
 * Merge provider-specific extensions without allowing them to replace the
 * Crux-owned runtime contract generated by core.
 */
function mergeRuntimeExtensions<TRuntime extends object, TExtensions extends object>(
  id: string,
  runtime: TRuntime,
  extensions: TExtensions,
): TRuntime & TExtensions {
  for (const key of Reflect.ownKeys(extensions)) {
    if (
      Object.prototype.propertyIsEnumerable.call(extensions, key) &&
      Object.prototype.hasOwnProperty.call(runtime, key)
    ) {
      throw new Error(
        `Provider runtime "${id}" extension cannot replace generated runtime key "${String(key)}".`,
      )
    }
  }

  return Object.freeze({
    ...runtime,
    ...extensions,
  }) as TRuntime & TExtensions
}

function describeModelFallback<TModel>(runtimeId: string, model: TModel): ModelInfo {
  if (typeof model === 'string') {
    const separator = model.indexOf(':')
    if (separator > 0) {
      return { provider: model.slice(0, separator), modelId: model.slice(separator + 1) }
    }
    return { provider: runtimeId, modelId: model }
  }

  if (typeof model === 'object' && model !== null) {
    const record = model as { readonly provider?: unknown; readonly modelId?: unknown; readonly id?: unknown }
    const provider = typeof record.provider === 'string' ? record.provider : runtimeId
    const modelId = typeof record.modelId === 'string' ? record.modelId : typeof record.id === 'string' ? record.id : ''
    return { provider, modelId }
  }

  return { provider: runtimeId, modelId: String(model) }
}
