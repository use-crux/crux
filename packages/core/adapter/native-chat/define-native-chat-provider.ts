/**
 * Compile native chat provider profiles into Crux adapter APIs.
 *
 * @module
 */

import type { z } from 'zod'
import type { GenerateObjectFn, GenerateTextFn } from '../../compaction'
import type { Message } from '../../messages'
import { adapter } from '../define-adapter'
import type { AdapterSpec } from '../spec'
import type { CallArgs, StreamHandle } from '../types'
import { appendNativeToolRound } from './tool-round'
import type {
  NativeCallMode,
  NativeChatHelpers,
  NativeChatProfile,
  NativeChatProvider,
  NativeProviderDepsArg,
  NativeProviderPort,
} from './types'

interface HelperCallArgs<TExtra extends Record<string, unknown>> {
  readonly model: string
  readonly system: string | undefined
  readonly prompt: string
  readonly schema: z.ZodType | undefined
  readonly schemaParams: Record<string, unknown> | undefined
  readonly extra: TExtra
}

/**
 * Create a compiled native chat provider from provider-owned wire hooks.
 *
 * The returned facade can produce an `AdapterSpec`, a public Crux adapter
 * factory, and lightweight `GenerateTextFn` / `GenerateObjectFn` helpers from
 * the same request and response path.
 *
 * @param profile - Provider wire-format recipe.
 * @returns A frozen native chat provider facade.
 *
 * @example
 * ```ts
 * const nativeOpenAI = defineNativeChatProvider({
 *   providerId: 'openai',
 *   request: openAIRequest,
 *   response: openAIResponse,
 *   stream: { request: openAIStreamRequest, textDelta: openAITextDelta },
 *   settings: openAISettings,
 *   outputSchema: openAIOutputSchema,
 *   messages: openAIMessageCodec,
 * })
 *
 * export const openaiSpec = nativeOpenAI.specFor(bindOpenAI)
 * export const createOpenAI = nativeOpenAI.createFor(bindOpenAI)
 * ```
 */
export function defineNativeChatProvider<
  TRequest,
  TRawResponse,
  TRawStream extends AsyncIterable<unknown>,
  TExtra extends Record<string, unknown>,
  TDeps extends Record<string, unknown> = Record<string, never>,
>(
  profile: NativeChatProfile<TRequest, TRawResponse, TRawStream, TExtra, TDeps>,
): NativeChatProvider<TRequest, TRawResponse, TRawStream, TExtra, TDeps> {
  function specFor<TClient>(
    bind: (client: TClient) => NativeProviderPort<TRequest, TRawResponse, TRawStream>,
    ...depsArg: NativeProviderDepsArg<TDeps>
  ): AdapterSpec<TClient, TRawResponse, TRawStream, TExtra> {
    const deps = resolveDeps(depsArg)
    const spec: AdapterSpec<TClient, TRawResponse, TRawStream, TExtra> = {
      providerId: profile.providerId,

      async call(client, args) {
        const mode = callModeFor(args)
        const request = await profile.request(args, { mode, deps })
        const raw = await bind(client).call(request, mode)
        return { raw, extracted: profile.response(raw) }
      },

      async stream(client, args): Promise<StreamHandle<TRawStream>> {
        const mode = callModeFor(args)
        const request = await profile.request(args, { mode, deps })
        const streamRequest = profile.stream.request?.(request) ?? request
        const rawStream = await bind(client).stream(streamRequest)
        return {
          rawStream,
          extractTextDelta: profile.stream.textDelta,
          completion: async () => profile.stream.completion?.(rawStream),
        }
      },

      appendToolRound: profile.appendToolRound ?? appendNativeToolRound,
      mapSettings: profile.settings,
    }

    if (profile.sanitizeToolSchema) spec.sanitizeToolSchema = profile.sanitizeToolSchema
    if (profile.outputSchema) spec.wrapOutputSchema = profile.outputSchema
    return spec
  }

  function createFor<TClient>(
    bind: (client: TClient) => NativeProviderPort<TRequest, TRawResponse, TRawStream>,
    ...depsArg: NativeProviderDepsArg<TDeps>
  ) {
    return adapter(specFor(bind, ...depsArg))
  }

  function helpers<TClient>(
    bind: (client: TClient) => NativeProviderPort<TRequest, TRawResponse, TRawStream>,
    ...depsArg: NativeProviderDepsArg<TDeps>
  ): NativeChatHelpers<TClient> {
    const deps = resolveDeps(depsArg)

    return Object.freeze({
      createGenerateTextFn(client: TClient, model: string): GenerateTextFn {
        const port = bind(client)
        return async (options) => {
          const args = helperCallArgs<TExtra>({
            model,
            system: options.system,
            prompt: options.prompt,
            schema: undefined,
            schemaParams: undefined,
            extra: {} as TExtra,
          })
          const request = await profile.request(args, { mode: 'text', deps })
          const raw = await port.call(request, 'text')
          return { text: profile.response(raw).text }
        }
      },

      createGenerateObjectFn(client: TClient, model: string): GenerateObjectFn {
        const port = bind(client)
        return async (options) => {
          if (!profile.outputSchema) {
            throw new TypeError(
              `Native chat profile "${profile.providerId}" cannot create GenerateObjectFn without outputSchema().`,
            )
          }

          const schemaParams = profile.outputSchema(options.schema)
          const args = helperCallArgs<TExtra>({
            model,
            system: options.system,
            prompt: options.prompt,
            schema: options.schema,
            schemaParams,
            extra: {} as TExtra,
          })
          const request = await profile.request(args, { mode: 'structured', deps })
          const raw = await port.call(request, 'structured')
          const parsed = profile.structuredObject?.(raw) ?? parseJson(profile.response(raw).text, profile.providerId)
          return { object: options.schema.parse(parsed) }
        }
      },
    })
  }

  return Object.freeze({ profile, specFor, createFor, helpers })
}

function callModeFor<TExtra extends Record<string, unknown>>(args: CallArgs<TExtra>): NativeCallMode {
  return args.schema || args.schemaParams ? 'structured' : 'text'
}

function resolveDeps<TDeps extends Record<string, unknown>>(depsArg: NativeProviderDepsArg<TDeps>): TDeps {
  return (depsArg[0] ?? {}) as TDeps
}

function helperCallArgs<TExtra extends Record<string, unknown>>(args: HelperCallArgs<TExtra>): CallArgs<TExtra> {
  const messages: Message[] = [{ role: 'user', content: args.prompt }]
  return {
    model: args.model,
    system: args.system,
    systemBlocks: undefined,
    messages,
    settings: {},
    schema: args.schema,
    schemaParams: args.schemaParams,
    tools: undefined,
    extra: args.extra,
  }
}

function parseJson(text: string, providerId: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch (error) {
    throw new SyntaxError(`Native chat profile "${providerId}" returned structured output that is not valid JSON.`, {
      cause: error,
    })
  }
}
