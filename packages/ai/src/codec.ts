import type { LanguageModel } from 'ai'
import type { GenerationSettings, Message, ResolvedPrompt } from '@use-crux/core'
import type { AdapterResponse } from '@use-crux/core/adapter'
import type { AIExtra } from './options'
import { extractModelInfo } from './provider-profile'
import { extractResponse } from './result-shape'
import { createAiSdkCodec } from './sdk-codec'
import type { SdkLoopResultLike } from './sdk-codec/types'

/** Options for AI SDK public {@link toParams} codec calls. */
export interface AiSdkCodecOptions {
  /** AI SDK language model object. */
  readonly model: LanguageModel
  /** Canonical settings merged after `resolved.settings`, then mapped to AI SDK call settings. */
  readonly settings?: GenerationSettings
  /** AI SDK-specific request options. */
  readonly extra?: AIExtra
  /** Optional conversation history override. */
  readonly messages?: readonly Message[]
}

/** Convert a resolved Crux prompt into AI SDK `generateText()` params. */
export function toParams(
  resolved: ResolvedPrompt,
  options: AiSdkCodecOptions,
): Record<string, unknown> {
  const codec = createAiSdkCodec()
  const modelInfo = extractModelInfo(options.model)
  const settings = {
    ...resolved.settings,
    ...(options.settings ?? {}),
  }
  const plan = codec.loop({
    model: options.model,
    modelInfo,
    system: resolved.system,
    systemBlocks: resolved.systemBlocks,
    prompt: options.messages?.length ? undefined : resolved.prompt,
    messages: options.messages ?? (resolved.messages as Message[] | undefined),
    settings: codec.mapSettings(settings, modelInfo),
    tools: undefined,
    toolApproval: undefined,
    activeTools: resolved.activeTools,
    maxSteps: settings.maxSteps ?? 10,
    observer: undefined,
    abortSignal: undefined,
    extra: options.extra,
  })
  return plan.args as Record<string, unknown>
}

/** Normalize an AI SDK generate result into Crux response facts. */
export function fromResponse(response: SdkLoopResultLike): AdapterResponse {
  return extractResponse(response)
}
