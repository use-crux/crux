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

  return {
    usage: result.usage
      ? {
          inputTokens: result.usage.prompt_tokens ?? 0,
          outputTokens: result.usage.completion_tokens ?? 0,
          totalTokens: result.usage.total_tokens ?? 0,
        }
      : { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    finishReason: choice?.finish_reason,
    responseId: result.id,
    actualModelId: result.model,
  }
}

/** Prefer OpenAI parsed structured output over transcript text when present. */
export function openAIResponseText(result: ChatCompletion, assistant: NativeAssistantTurn): string {
  const choiceMessage = result.choices?.[0]?.message as
    | (OpenAI.ChatCompletionMessage & { readonly parsed?: unknown })
    | undefined
  if (choiceMessage?.parsed == null) return assistant.text
  return typeof choiceMessage.parsed === 'string' ? choiceMessage.parsed : JSON.stringify(choiceMessage.parsed)
}
