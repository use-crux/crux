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

  return {
    usage: {
      inputTokens: response.usageMetadata?.promptTokenCount ?? undefined,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? undefined,
      totalTokens:
        response.usageMetadata?.totalTokenCount ??
        (response.usageMetadata?.promptTokenCount != null && response.usageMetadata.candidatesTokenCount != null
          ? response.usageMetadata.promptTokenCount + response.usageMetadata.candidatesTokenCount
          : undefined),
      cacheReadTokens: response.usageMetadata?.cachedContentTokenCount,
    },
    finishReason: candidate?.finishReason?.toLowerCase(),
    responseId: undefined,
    actualModelId: response.modelVersion,
  }
}

/** Prefer Google response text over reconstructed transcript text when present. */
export function googleResponseText(response: GenerateContentResponse, assistant: NativeAssistantTurn): string {
  return response.text ?? assistant.text
}
