/**
 * Provider runtime compiler.
 *
 * @module
 */

import { defineNativeChatProvider } from "../native-chat";
import { createLoopOwnedProviderRuntime } from "./loop-compiler";
import { createDefinedProviderRuntime } from "./runtime-factory";
import {
  bindProviderCompletedOperations,
  type DefinedCompletedOperations,
  type ProviderCompletedOperationFactory,
} from "./completed-operations";
import {
  bindProviderStreamingOperations,
  type DefinedStreamingOperations,
  type ProviderStreamingOperationFactories,
} from "./streaming-operations";
import type {
  DefinedProviderRuntime,
  DefinedSingleTurnProviderRuntime,
  LoopOwnedProviderRuntime,
  LoopOwnedProviderRuntimeSpec,
  ProviderOwnership,
  ProviderRuntimeDepsArg,
  ProviderRuntimeSpec,
  SingleTurnProviderRuntime,
  SingleTurnProviderRuntimeSpec,
} from "./types";

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
 *   ownership: 'single-turn',
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
  TExtensions extends object = Record<never, never>,
  TImage extends ProviderCompletedOperationFactory<TClient> | undefined =
    undefined,
  TTranscription extends
    | ProviderCompletedOperationFactory<TClient>
    | undefined = undefined,
  TSpeech extends ProviderCompletedOperationFactory<TClient> | undefined =
    undefined,
  TStreaming extends ProviderStreamingOperationFactories<TClient> | undefined =
    undefined,
>(
  spec: SingleTurnProviderRuntimeSpec<
    TClient,
    TRequest,
    TRawResponse,
    TRawStream,
    TExtra,
    TDeps,
    TProviderMessage,
    TExtensions,
    TImage,
    TTranscription,
    TSpeech,
    TStreaming
  >,
): DefinedSingleTurnProviderRuntime<
  TClient,
  TRawResponse,
  TRawStream,
  TExtra,
  TDeps,
  TExtensions,
  DefinedCompletedOperations<TImage, TTranscription, TSpeech> &
    DefinedStreamingOperations<TStreaming>
>;

/**
 * Define a Crux provider runtime from loop-owned SDK mechanics.
 *
 * Use this branch for SDKs, such as the Vercel AI SDK, that own the
 * multi-step model/tool loop. The SDK remains outside `@use-crux/core`; core
 * receives only structural hooks and compiles them into the existing
 * executor runtime.
 *
 * @param spec - Provider id plus loop-owned SDK mechanics.
 * @returns A frozen provider runtime.
 */
export function defineProviderRuntime<
  TClient,
  TModel,
  TRawResponse = unknown,
  TRawStream = unknown,
  TExtensions extends object = Record<never, never>,
  TImage extends ProviderCompletedOperationFactory<TClient> | undefined =
    undefined,
  TTranscription extends
    | ProviderCompletedOperationFactory<TClient>
    | undefined = undefined,
  TSpeech extends ProviderCompletedOperationFactory<TClient> | undefined =
    undefined,
  TStreaming extends ProviderStreamingOperationFactories<TClient> | undefined =
    undefined,
>(
  spec: LoopOwnedProviderRuntimeSpec<
    TClient,
    TModel,
    TRawResponse,
    TRawStream,
    TExtensions,
    TImage,
    TTranscription,
    TSpeech,
    TStreaming
  >,
): DefinedProviderRuntime<
  TClient,
  TModel,
  TRawResponse,
  TRawStream,
  Record<string, unknown>,
  Record<string, never>,
  LoopOwnedProviderRuntime<TClient, TModel, TRawResponse, TRawStream> &
    DefinedCompletedOperations<TImage, TTranscription, TSpeech> &
    DefinedStreamingOperations<TStreaming>,
  TExtensions,
  "loop-owned"
>;

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
  const runtimeId = spec.id;
  const ownership = resolveProviderOwnership(spec);

  if (ownership === "single-turn") {
    const singleTurnSpec = spec as AnySingleTurnRuntimeSpec;
    const { bind, ...turnContract } = singleTurnSpec.turn;
    const provider = defineNativeChatProvider({
      ...turnContract,
      providerId: runtimeId,
    });

    return Object.freeze({
      ...createDefinedProviderRuntime(
        runtimeId,
        "single-turn",
        (
          client: unknown,
          ...depsArg: ProviderRuntimeDepsArg<Record<string, unknown>>
        ) =>
          Object.freeze({
            ...provider.createFor(bind, ...depsArg)(client),
            ...bindProviderCompletedOperations(
              runtimeId,
              client,
              singleTurnSpec,
            ),
            ...bindProviderStreamingOperations(
              runtimeId,
              client,
              singleTurnSpec.streaming,
            ),
          }),
        singleTurnSpec.extend,
      ),
      helpers(...depsArg: ProviderRuntimeDepsArg<Record<string, unknown>>) {
        return provider.helpers(bind, ...depsArg);
      },
    });
  }

  return createLoopOwnedProviderRuntime(spec as AnyLoopOwnedRuntimeSpec);
}

type AnySingleTurnRuntimeSpec = SingleTurnProviderRuntimeSpec<
  unknown,
  unknown,
  unknown,
  AsyncIterable<unknown>,
  Record<string, unknown>,
  Record<string, unknown>,
  unknown,
  object,
  ProviderCompletedOperationFactory<unknown> | undefined,
  ProviderCompletedOperationFactory<unknown> | undefined,
  ProviderCompletedOperationFactory<unknown> | undefined,
  ProviderStreamingOperationFactories<unknown> | undefined
>;

type AnyLoopOwnedRuntimeSpec = LoopOwnedProviderRuntimeSpec<
  unknown,
  unknown,
  unknown,
  unknown,
  object,
  ProviderCompletedOperationFactory<unknown> | undefined,
  ProviderCompletedOperationFactory<unknown> | undefined,
  ProviderCompletedOperationFactory<unknown> | undefined,
  ProviderStreamingOperationFactories<unknown> | undefined
>;

interface RuntimeSpecShape {
  readonly id: string;
  readonly ownership?: unknown;
  readonly turn?: unknown;
  readonly loop?: unknown;
}

/**
 * Resolve the ownership model once at the public boundary.
 *
 * Specs authored before the ownership field was added still infer cleanly from
 * their mechanics. Explicit specs get a clear runtime error when loose
 * JavaScript or casts provide a mismatched discriminant.
 */
function resolveProviderOwnership(
  spec: ProviderRuntimeSpec,
): ProviderOwnership {
  const shape = spec as RuntimeSpecShape;
  const hasTurn = shape.turn !== undefined;
  const hasLoop = shape.loop !== undefined;

  if (hasTurn === hasLoop) {
    throw new Error(
      `Provider runtime "${shape.id}" must define exactly one of turn or loop mechanics.`,
    );
  }

  const inferred: ProviderOwnership = hasTurn ? "single-turn" : "loop-owned";
  if (shape.ownership === undefined) return inferred;

  if (shape.ownership !== "single-turn" && shape.ownership !== "loop-owned") {
    throw new Error(
      `Provider runtime "${shape.id}" declares unknown ownership "${String(shape.ownership)}".`,
    );
  }

  if (shape.ownership !== inferred) {
    throw new Error(
      `Provider runtime "${shape.id}" declares ownership "${shape.ownership}" but defines ${inferred} mechanics.`,
    );
  }

  return shape.ownership;
}
