import type { GenerateContentResponse } from '@google/genai'
import type { AdapterResponse } from '@use-crux/core/adapter'
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
  const usage = googleUsage(response)

  return {
    usage,
    finishReason: candidate?.finishReason?.toLowerCase(),
    responseId: undefined,
    actualModelId: response.modelVersion,
  }
}

function googleUsage(response: GenerateContentResponse): AdapterResponse['usage'] {
  const metadata = response.usageMetadata
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
