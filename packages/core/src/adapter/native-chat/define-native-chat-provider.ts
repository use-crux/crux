/**
 * Compile native chat provider specs into Crux adapter APIs.
 *
 * @module
 */

import type { z } from "zod";
import type { GenerateObjectFn, GenerateTextFn } from "../../compaction";
import type { Message } from "../../generation/messages";
import { adapter } from "../define-adapter";
import type { AdapterSpec } from "../spec";
import type { AdapterResponse, CallArgs, StreamHandle } from "../types";
import { appendNativeToolRound } from "./tool-round";
import {
  assertProviderMediaSupported,
  attachProviderMediaHooks,
} from "./media-hooks";
import type {
  NativeCallMode,
  NativeChatRequestArgs,
  NativeChatHelpers,
  NativeChatProfile,
  NativeChatProvider,
  NativeProviderDepsArg,
  NativeProviderPort,
  NativeTranscriptCodec,
} from "./types";

interface HelperCallArgs<TExtra extends Record<string, unknown>> {
  readonly model: string;
  readonly system: string | undefined;
  readonly prompt?: string;
  readonly messages?: readonly Message[];
  readonly maxOutputTokens?: number;
  readonly schema: z.ZodType | undefined;
  readonly schemaParams: Record<string, unknown> | undefined;
  readonly extra: TExtra;
}

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

      async call(client, args) {
        const mode = callModeFor(args);
        const request = await profile.request(requestArgsFor(profile, args), {
          mode,
          deps,
        });
        const raw = await bind(client).call(request, mode);
        return { raw, extracted: responseFor(profile, raw) };
      },

      async stream(client, args): Promise<StreamHandle<TRawStream>> {
        const mode = callModeFor(args);
        const request = await profile.request(requestArgsFor(profile, args), {
          mode,
          deps,
        });
        const streamRequest = profile.stream.request?.(request) ?? request;
        const rawStream = await bind(client).stream(streamRequest);
        const chunks: unknown[] = [];
        const trackedStream = trackStream(rawStream, chunks);
        return {
          raw: rawStream,
          rawStream: trackedStream,
          extractTextDelta: profile.stream.textDelta,
          completion: async () =>
            profile.stream.completion?.(rawStream, chunks),
        };
      },
      toParams(args) {
        return profile.request(requestArgsFor(profile, args), {
          mode: callModeFor(args),
          deps,
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
    if (profile.outputSchema) spec.wrapOutputSchema = profile.outputSchema;
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

    return Object.freeze({
      createGenerateTextFn(client: TClient, model: string): GenerateTextFn {
        const port = bind(client);
        return async (options) => {
          const args = helperCallArgs<TExtra>({
            model,
            system: options.system,
            ...(options.prompt !== undefined
              ? { prompt: options.prompt }
              : { messages: options.messages }),
            maxOutputTokens: options.maxOutputTokens,
            schema: undefined,
            schemaParams: undefined,
            extra: {} as TExtra,
          });
          const request = await profile.request(requestArgsFor(profile, args), {
            mode: "text",
            deps,
          });
          const raw = await port.call(request, "text");
          return { text: responseFor(profile, raw).text };
        };
      },

      createGenerateObjectFn(client: TClient, model: string): GenerateObjectFn {
        const port = bind(client);
        return async (options) => {
          if (!profile.outputSchema) {
            throw new TypeError(
              `Native chat profile "${profile.providerId}" cannot create GenerateObjectFn without outputSchema().`,
            );
          }

          const schemaParams = profile.outputSchema(options.schema);
          const args = helperCallArgs<TExtra>({
            model,
            system: options.system,
            prompt: options.prompt,
            schema: options.schema,
            schemaParams,
            extra: {} as TExtra,
          });
          const request = await profile.request(requestArgsFor(profile, args), {
            mode: "structured",
            deps,
          });
          const raw = await port.call(request, "structured");
          const parsed =
            profile.structuredObject?.(raw) ??
            parseJson(responseFor(profile, raw).text, profile.providerId);
          return { object: options.schema.parse(parsed) };
        };
      },
    });
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
  return args.schema || args.schemaParams ? "structured" : "text";
}

function resolveDeps<TDeps extends Record<string, unknown>>(
  depsArg: NativeProviderDepsArg<TDeps>,
): TDeps {
  return (depsArg[0] ?? {}) as TDeps;
}

function helperCallArgs<TExtra extends Record<string, unknown>>(
  args: HelperCallArgs<TExtra>,
): CallArgs<TExtra> {
  const messages: Message[] = args.messages
    ? args.messages.map((message) => ({ ...message }))
    : [{ role: "user", content: args.prompt ?? "" }];
  return {
    model: args.model,
    system: args.system,
    systemBlocks: undefined,
    messages,
    settings:
      args.maxOutputTokens === undefined
        ? {}
        : { maxTokens: args.maxOutputTokens },
    schema: args.schema,
    schemaParams: args.schemaParams,
    tools: undefined,
    extra: args.extra,
  };
}

function requestArgsFor<
  TRequest,
  TRawResponse,
  TRawStream extends AsyncIterable<unknown>,
  TExtra extends Record<string, unknown>,
  TDeps extends Record<string, unknown>,
  TProviderMessage,
>(
  profile: Pick<
    NativeChatProfile<
      TRequest,
      TRawResponse,
      TRawStream,
      TExtra,
      TDeps,
      TProviderMessage
    >,
    "media" | "providerId" | "transcript"
  >,
  args: CallArgs<TExtra>,
): NativeChatRequestArgs<TExtra, TProviderMessage> {
  assertProviderMediaSupported(profile, {
    model: args.model,
    messages: args.messages,
  });
  return {
    ...args,
    providerMessages: providerMessagesFor(profile, args.messages),
  };
}

function providerMessagesFor<TProviderMessage, TRawResponse>(
  profile: {
    readonly transcript: NativeTranscriptCodec<TProviderMessage, TRawResponse>;
  },
  messages: readonly Message[],
): readonly TProviderMessage[] {
  return profile.transcript.fromMessages(messages);
}

function responseFor<
  TRequest,
  TRawResponse,
  TRawStream extends AsyncIterable<unknown>,
  TExtra extends Record<string, unknown>,
  TDeps extends Record<string, unknown>,
  TProviderMessage,
>(
  profile: Pick<
    NativeChatProfile<
      TRequest,
      TRawResponse,
      TRawStream,
      TExtra,
      TDeps,
      TProviderMessage
    >,
    "providerId" | "response" | "transcript"
  >,
  raw: TRawResponse,
): AdapterResponse {
  const assistant = profile.transcript.readAssistant(raw);
  const text = profile.response.text?.(raw, assistant) ?? assistant.text;
  const content =
    text !== assistant.text
      ? [{ type: "text" as const, text }]
      : assistant.content === undefined
        ? undefined
        : typeof assistant.content === "string"
          ? [{ type: "text" as const, text: assistant.content }]
          : assistant.content;
  return {
    ...profile.response.meta(raw),
    ...(content !== undefined ? { content } : {}),
    text,
    toolCalls: assistant.toolCalls,
  };
}

function parseJson(text: string, providerId: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new SyntaxError(
      `Native chat profile "${providerId}" returned structured output that is not valid JSON.`,
      {
        cause: error,
      },
    );
  }
}
