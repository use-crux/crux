import type { GenerateContentResponse } from '@google/genai'
import type { AdapterResponse, CruxFinishReason } from '@use-crux/core/adapter'
import type { NativeAssistantTurn, NativeResponseMetadata } from '@use-crux/core/adapter'
import { googleTranscript } from './message-codec'

/** Normalize a Google GenAI response into Crux's canonical adapter response. */
export function googleResponse(response: GenerateContentResponse): AdapterResponse {
  const assistant = googleTranscript.readAssistant(response)
  return {
    ...googleResponseMeta(response),
    text: googleResponseText(response, assistant),
    toolCalls: assistant.toolCalls,
  }
}

/** Read response metadata that is not owned by Google transcript conversion. */
export function googleResponseMeta(response: GenerateContentResponse): NativeResponseMetadata {
  const candidate = response.candidates?.[0]
  const usage = googleUsage(response.usageMetadata)

  return {
    usage,
    finishReason: mapGoogleFinishReason(candidate?.finishReason, response.promptFeedback?.blockReason),
    responseId: undefined,
    actualModelId: response.modelVersion,
  }
}

/**
 * Normalize a Google `finishReason` (and any prompt-side safety block) into the
 * provider-neutral finish reason. A `promptFeedback.blockReason` reports the
 * prompt itself was blocked before generation, which is a content-filter
 * outcome regardless of `finishReason`.
 */
export function mapGoogleFinishReason(
  finishReason: string | undefined,
  blockReason?: string | undefined,
): CruxFinishReason | undefined {
  if (typeof blockReason === 'string' && blockReason.length > 0) return 'content-filter'
  switch (finishReason) {
    case undefined:
      return undefined
    case 'STOP':
      return 'stop'
    case 'MAX_TOKENS':
      return 'length'
    case 'SAFETY':
    case 'RECITATION':
    case 'BLOCKLIST':
    case 'PROHIBITED_CONTENT':
    case 'SPII':
      return 'content-filter'
    case 'FUNCTION_CALL':
    case 'TOOL_CALL':
      return 'tool-calls'
    case 'MALFORMED_FUNCTION_CALL':
      return 'error'
    default:
      return 'unknown'
  }
}

/** Normalize Google usage metadata (shared by non-streaming and streaming completion) into canonical token usage. */
export function googleUsage(metadata: GenerateContentResponse['usageMetadata']): AdapterResponse['usage'] {
  if (!metadata) return undefined

  const inputTokens = metadata.promptTokenCount
  const outputTokens =
    metadata.candidatesTokenCount ??
    (metadata.totalTokenCount !== undefined && inputTokens !== undefined ? metadata.totalTokenCount - inputTokens : undefined)
  if (inputTokens === undefined || outputTokens === undefined) return undefined

  return {
    inputTokens,
    outputTokens,
    totalTokens: metadata.totalTokenCount ?? inputTokens + outputTokens,
    inputTokenDetails: {
      ...optionalTokenDetail('cacheReadTokens', metadata.cachedContentTokenCount),
    },
    outputTokenDetails: {
      ...optionalTokenDetail('reasoningTokens', metadata.thoughtsTokenCount),
    },
  }
}

function optionalTokenDetail<K extends string>(key: K, value: number | undefined): Partial<Record<K, number>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, number>)
}

/** Prefer Google response text over reconstructed transcript text when present. */
export function googleResponseText(response: GenerateContentResponse, assistant: NativeAssistantTurn): string {
  return response.text ?? assistant.text
}
