/**
 * Compile native chat provider specs into Crux adapter APIs.
 *
 * @module
 */

import { adapter } from "../define-adapter";
import type { AdapterSpec } from "../spec";
import type { CallArgs, StreamHandle } from "../types";
import { appendNativeToolRound } from "./tool-round";
import {
  validateStructuredOutputCapabilities,
} from "../structured-output";
import { attachProviderMediaHooks } from "./media-hooks";
import type {
  NativeCallMode,
  NativeChatProfile,
  NativeProviderPort,
} from "./types";
import type { NativeChatHelpers } from "./helper-types";
import { createNativeChatHelpers } from "./helpers";
import type {
  NativeChatProvider,
  NativeProviderDepsArg,
} from "./provider-types";
import { requestArgsFor, responseFor } from "./request-response";

/**
 * Create a compiled native chat provider from provider-owned wire hooks.
 *
 * This is the compiler behind single-turn provider runtimes. The returned
 * facade can produce the low-level `AdapterSpec`, the adapter runtime factory,
 * and lightweight `GenerateTextFn` / `GenerateObjectFn` helpers from the same
 * request and response path.
 *
 * @param profile - Provider wire-format recipe.
 * @returns A frozen native chat provider facade.
 *
 * @example
 * ```ts
 * const provider = defineNativeChatProvider({
 *   providerId: 'example',
 *   request: openAIRequest,
 *   response: openAIResponse,
 *   stream: { request: openAIStreamRequest, textDelta: openAITextDelta },
 *   settings: openAISettings,
 *   outputSchema: openAIOutputSchema,
 *   transcript: openAITranscript,
 * })
 *
 * const helpers = provider.helpers(bindClient)
 * ```
 */
export function defineNativeChatProvider<
  TRequest,
  TRawResponse,
  TRawStream extends AsyncIterable<unknown>,
  TExtra extends Record<string, unknown>,
  TDeps extends Record<string, unknown> = Record<string, never>,
  TProviderMessage = unknown,
>(
  profile: NativeChatProfile<
    TRequest,
    TRawResponse,
    TRawStream,
    TExtra,
    TDeps,
    TProviderMessage
  >,
): NativeChatProvider<
  TRequest,
  TRawResponse,
  TRawStream,
  TExtra,
  TDeps,
  TProviderMessage
> {
  function specFor<TClient>(
    bind: (
      client: TClient,
    ) => NativeProviderPort<TRequest, TRawResponse, TRawStream>,
    ...depsArg: NativeProviderDepsArg<TDeps>
  ): AdapterSpec<TClient, TRawResponse, TRawStream, TExtra, TRequest> {
    const deps = resolveDeps(depsArg);
    const spec: AdapterSpec<
      TClient,
      TRawResponse,
      TRawStream,
      TExtra,
      TRequest
    > = {
      providerId: profile.providerId,

      materializeToolSource: profile.materializeToolSource,

      async call(client, args, context) {
        const mode = callModeFor(args);
        const request = await profile.request(requestArgsFor(profile, args), {
          mode,
          deps,
          outputSchema: args.outputSchema,
        });
        const raw = await bind(client).call(request, mode, {
          signal: context?.signal,
        });
        return { raw, extracted: responseFor(profile, raw, request) };
      },

      async stream(client, args, context): Promise<StreamHandle<TRawStream>> {
        const mode = callModeFor(args);
        const request = await profile.request(requestArgsFor(profile, args), {
          mode,
          deps,
          outputSchema: args.outputSchema,
        });
        const streamRequest = profile.stream.request?.(request) ?? request;
        const rawStream = await bind(client).stream(streamRequest, {
          signal: context?.signal,
        });
        const chunks: unknown[] = [];
        const trackedStream = trackStream(rawStream, chunks);
        return {
          raw: rawStream,
          rawStream: trackedStream,
          extractTextDelta: profile.stream.textDelta,
          completion: async () =>
            profile.stream.completion?.(rawStream, chunks, streamRequest),
        };
      },
      toParams(args) {
        return profile.request(requestArgsFor(profile, args), {
          mode: callModeFor(args),
          deps,
          outputSchema: args.outputSchema,
        });
      },
      fromResponse(raw) {
        return responseFor(profile, raw);
      },
      appendToolRound: (messages, assistant, results) => {
        const append =
          profile.appendToolRound ?? profile.transcript?.appendToolRound;
        return append
          ? append(messages, assistant, results)
          : appendNativeToolRound(messages, assistant, results);
      },
      mapSettings: profile.settings,
    };

    if (profile.sanitizeToolSchema)
      spec.sanitizeToolSchema = profile.sanitizeToolSchema;
    if (profile.structuredOutput) {
      // Reject a contradictory capability profile at definition, not on the
      // first structured request that happens to reach it.
      validateStructuredOutputCapabilities(profile.structuredOutput.accepts);
      spec.structuredOutput = profile.structuredOutput;
    }
    if (profile.mapError) spec.mapError = profile.mapError;
    return attachProviderMediaHooks(spec, profile.media);
  }

  function createFor<TClient>(
    bind: (
      client: TClient,
    ) => NativeProviderPort<TRequest, TRawResponse, TRawStream>,
    ...depsArg: NativeProviderDepsArg<TDeps>
  ) {
    return adapter(specFor(bind, ...depsArg));
  }

  function helpers<TClient>(
    bind: (
      client: TClient,
    ) => NativeProviderPort<TRequest, TRawResponse, TRawStream>,
    ...depsArg: NativeProviderDepsArg<TDeps>
  ): NativeChatHelpers<TClient> {
    const deps = resolveDeps(depsArg);
    return createNativeChatHelpers(profile, bind, deps);
  }

  return Object.freeze({ profile, specFor, createFor, helpers });
}

function trackStream<TStream extends AsyncIterable<unknown>>(
  stream: TStream,
  chunks: unknown[],
): TStream {
  return {
    async *[Symbol.asyncIterator]() {
      for await (const chunk of stream) {
        chunks.push(chunk);
        yield chunk;
      }
    },
  } as unknown as TStream;
}

function callModeFor<TExtra extends Record<string, unknown>>(
  args: CallArgs<TExtra>,
): NativeCallMode {
  return args.schema || args.outputSchema ? "structured" : "text";
}

function resolveDeps<TDeps extends Record<string, unknown>>(
  depsArg: NativeProviderDepsArg<TDeps>,
): TDeps {
  return (depsArg[0] ?? {}) as TDeps;
}
