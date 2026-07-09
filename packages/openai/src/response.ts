import type OpenAI from 'openai'
import type { ChatCompletion } from 'openai/resources/chat/completions'
import type { AdapterResponse } from '@use-crux/core/adapter'
import type { NativeAssistantTurn, NativeResponseMetadata } from '@use-crux/core/adapter'
import { openAITranscript } from './message-codec'

/** Normalize an OpenAI chat completion into Crux's canonical adapter response. */
export function openAIResponse(result: ChatCompletion): AdapterResponse {
  const assistant = openAITranscript.readAssistant(result)
  return {
    ...openAIResponseMeta(result),
    text: openAIResponseText(result, assistant),
    toolCalls: assistant.toolCalls,
  }
}

/** Read response metadata that is not owned by OpenAI transcript conversion. */
export function openAIResponseMeta(result: ChatCompletion): NativeResponseMetadata {
  const choice = result.choices?.[0]
  const usage = result.usage ?? undefined

  return {
    usage:
      usage !== undefined
        ? {
            inputTokens: usage.prompt_tokens,
            outputTokens: usage.completion_tokens,
            totalTokens: usage.total_tokens,
            inputTokenDetails: {
              ...optionalTokenDetail('cacheReadTokens', usage.prompt_tokens_details?.cached_tokens),
            },
            outputTokenDetails: {
              ...optionalTokenDetail('reasoningTokens', usage.completion_tokens_details?.reasoning_tokens),
            },
          }
        : undefined,
    finishReason: choice?.finish_reason,
    responseId: result.id,
    actualModelId: result.model,
  }
}

function optionalTokenDetail<K extends string>(key: K, value: number | undefined): Partial<Record<K, number>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, number>)
}

/** Prefer OpenAI parsed structured output over transcript text when present. */
export function openAIResponseText(result: ChatCompletion, assistant: NativeAssistantTurn): string {
  const choiceMessage = result.choices?.[0]?.message as
    | (OpenAI.ChatCompletionMessage & { readonly parsed?: unknown })
    | undefined
  if (choiceMessage?.parsed == null) return assistant.text
  return typeof choiceMessage.parsed === 'string' ? choiceMessage.parsed : JSON.stringify(choiceMessage.parsed)
}
