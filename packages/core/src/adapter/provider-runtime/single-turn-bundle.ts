/**
 * High-level single-turn provider bundle compiler.
 *
 * @module
 */

import { defineProviderRuntime } from "./define";
import type { ProviderRuntimeDepsArg } from "./runtime-types";
import type { ProviderCompletedOperationFactory } from "./completed-operations";
import type { ProviderStreamingOperationFactories } from "./streaming-operations";
import type {
  DefinedSingleTurnProviderBundle,
  SingleTurnProviderBundleSpec,
} from "./single-turn-bundle-types";

/**
 * Define a provider runtime bundle for SDKs that execute one native turn at a time.
 *
 * This is the ergonomic authoring surface for OpenAI-, Anthropic-, and
 * Google-style providers. Provider packages keep ownership of SDK binding,
 * request construction, response normalization, stream extraction, settings,
 * schemas, transcripts, and provider-local dependencies. Core compiles those
 * hooks through `defineProviderRuntime()` so generation, streaming, helper
 * factories, extension checks, and ownership metadata stay consistent.
 *
 * @param spec - Provider id, native SDK binder, profile hooks, optional deps, and extensions.
 * @returns A frozen bundle containing the lower-level runtime plus mapped `create()` and `helpers()` factories.
 *
 * @example
 * ```ts
 * const openai = defineSingleTurnProviderBundle({
 *   id: 'openai',
 *   bind: bindOpenAI,
 *   profile: {
 *     request: openAIRequest,
 *     response: { meta: openAIResponseMeta, text: openAIResponseText },
 *     stream: { request: openAIStreamRequest, textDelta: openAITextDelta },
 *     settings: openAISettings,
 *     outputSchema: openAIOutputSchema,
 *     transcript: openAITranscript,
 *   },
 * })
 *
 * export const openaiProviderRuntime = openai.runtime
 * export const createOpenAI = openai.create
 * export const openAIHelpers = openai.helpers()
 * ```
 */
export function defineSingleTurnProviderBundle<
  TClient,
  TRequest,
  TRawResponse,
  TRawStream extends AsyncIterable<unknown>,
  TExtra extends Record<string, unknown>,
  TDeps extends Record<string, unknown> = Record<string, never>,
  TProviderMessage = unknown,
  TCreateArgs extends readonly unknown[] = ProviderRuntimeDepsArg<TDeps>,
  THelperArgs extends readonly unknown[] = ProviderRuntimeDepsArg<TDeps>,
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
  spec: SingleTurnProviderBundleSpec<
    TClient,
    TRequest,
    TRawResponse,
    TRawStream,
    TExtra,
    TDeps,
    TProviderMessage,
    TCreateArgs,
    THelperArgs,
    TExtensions,
    TImage,
    TTranscription,
    TSpeech,
    TStreaming
  >,
): DefinedSingleTurnProviderBundle<
  TClient,
  TRawResponse,
  TRawStream,
  TExtra,
  TDeps,
  TCreateArgs,
  THelperArgs,
  TExtensions,
  TImage,
  TTranscription,
  TSpeech,
  TStreaming
> {
  const runtime = defineProviderRuntime<
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
  >({
    id: spec.id,
    ownership: "single-turn",
    turn: {
      bind: spec.bind,
      ...spec.profile,
    },
    extend: spec.extend,
    ...(spec.image === undefined ? {} : { image: spec.image }),
    ...(spec.transcription === undefined
      ? {}
      : { transcription: spec.transcription }),
    ...(spec.speech === undefined ? {} : { speech: spec.speech }),
    ...(spec.streaming === undefined ? {} : { streaming: spec.streaming }),
  });

  return Object.freeze({
    id: spec.id,
    ownership: "single-turn" as const,
    runtime,
    create(client: TClient, ...args: [...TCreateArgs]) {
      const deps = spec.deps?.create
        ? spec.deps.create(client, ...args)
        : depsFromArgs<TDeps>(args);
      return runtime.create(client, ...depsArgFor(deps));
    },
    helpers(...args: [...THelperArgs]) {
      const deps = spec.deps?.helpers
        ? spec.deps.helpers(...args)
        : depsFromArgs<TDeps>(args);
      return runtime.helpers(...depsArgFor(deps));
    },
  });
}

function depsFromArgs<TDeps extends Record<string, unknown>>(
  args: readonly unknown[],
): TDeps {
  return (args[0] ?? {}) as TDeps;
}

function depsArgFor<TDeps extends Record<string, unknown>>(
  deps: TDeps,
): ProviderRuntimeDepsArg<TDeps> {
  return [deps] as unknown as ProviderRuntimeDepsArg<TDeps>;
}
