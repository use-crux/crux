import type { GenerateContentResponse, GoogleGenAI } from '@google/genai'
import type { GenerationSettings, Message, ResolvedPrompt } from '@use-crux/core'
import { callArgsFromResolvedPrompt, type AdapterResponse, type ToolDescriptor } from '@use-crux/core/adapter'
import {
  disabledCachedContentLifecycle,
  resolveCachedContentLifecycle,
  type GoogleCachedContentLifecycle,
  type GoogleCachedContentOption,
} from './cached-content'
import {
  asGoogleGenerateContentParams,
  googleOutputSchema,
  googleRequest,
  googleSettings,
} from './request'
import { googleTranscript } from './message-codec'
import { googleResponse } from './response'
import type { GoogleExtra } from './types'

/** Options for Google public {@link toParams} codec calls. */
export interface GoogleCodecOptions {
  /** Google model id to place in the request body. */
  readonly model: string
  /** Canonical settings merged after `resolved.settings`, then mapped to Google fields. */
  readonly settings?: GenerationSettings
  /** Google-specific request options. */
  readonly extra?: GoogleExtra
  /** Optional conversation history override. */
  readonly messages?: readonly Message[]
  /** Prebuilt tool descriptors for translation-only codec calls. */
  readonly tools?: readonly ToolDescriptor[]
  /**
   * CachedContent lifecycle for request planning.
   *
   * Omit to use the same disabled inline fallback as direct provider-runtime
   * calls without `createGoogle()` dependencies.
   */
  readonly cachedContentLifecycle?: GoogleCachedContentLifecycle
}

/** Resolve a Google CachedContent lifecycle for public codec calls. */
export function googleCodecCachedContent(
  client: GoogleGenAI,
  option?: GoogleCachedContentOption,
): GoogleCachedContentLifecycle {
  return resolveCachedContentLifecycle(client, option)
}

/** Convert a resolved Crux prompt into Google generate-content params. */
export async function toParams(
  resolved: ResolvedPrompt,
  options: GoogleCodecOptions,
): Promise<Parameters<GoogleGenAI['models']['generateContent']>[0]> {
  const generationSettings = {
    ...resolved.settings,
    ...(options.settings ?? {}),
  }
  const settings = googleSettings(generationSettings)
  const callArgs = callArgsFromResolvedPrompt(resolved, {
      model: options.model,
      settings,
      unsupportedContent: generationSettings.unsupportedContent,
      extra: options.extra,
      messages: options.messages,
      tools: options.tools ? [...options.tools] : undefined,
      schemaParams: resolved.schema ? googleOutputSchema(resolved.schema) : undefined,
    })
  const request = await googleRequest(
    {
      ...callArgs,
      providerMessages: googleTranscript.fromMessages(callArgs.messages, {
        unsupportedContent: callArgs.unsupportedContent,
      }),
    },
    options.cachedContentLifecycle ?? disabledCachedContentLifecycle(),
  )
  return asGoogleGenerateContentParams(request)
}

/** Normalize a Google SDK response into Crux response facts. */
export function fromResponse(response: GenerateContentResponse): AdapterResponse {
  return googleResponse(response)
}
