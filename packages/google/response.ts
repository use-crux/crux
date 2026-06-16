import type { GenerateContentResponse } from '@google/genai'
import type { AdapterResponse } from '@crux/core/adapter'

/** Normalize a Google GenAI response into Crux's canonical adapter response. */
export function googleResponse(response: GenerateContentResponse): AdapterResponse {
  const candidate = response.candidates?.[0]
  const functionCalls = (candidate?.content?.parts ?? []).flatMap((part) => {
    if (!isRecord(part)) return []
    const functionCall = part.functionCall
    return isGoogleFunctionCall(functionCall) ? [functionCall] : []
  })

  return {
    text: response.text ?? '',
    toolCalls:
      functionCalls.length > 0
        ? functionCalls.map((functionCall, index) => ({
            id: functionCall.id ?? `tc_${index}`,
            name: functionCall.name ?? '',
            args: functionCall.args,
          }))
        : undefined,
    usage: {
      inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      totalTokens: response.usageMetadata?.totalTokenCount ?? 0,
      cacheReadTokens: response.usageMetadata?.cachedContentTokenCount,
    },
    finishReason: candidate?.finishReason?.toLowerCase(),
    responseId: undefined,
    actualModelId: response.modelVersion,
  }
}

interface GoogleFunctionCall {
  readonly id?: string
  readonly name?: string
  readonly args?: Record<string, unknown>
}

function isGoogleFunctionCall(value: unknown): value is GoogleFunctionCall {
  return isRecord(value) && optionalString(value.id) && optionalString(value.name)
}

function optionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
