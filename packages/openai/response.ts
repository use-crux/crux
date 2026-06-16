import type OpenAI from 'openai'
import type { ChatCompletion } from 'openai/resources/chat/completions'
import type { AdapterResponse } from '@crux/core/adapter'

/** Normalize an OpenAI chat completion into Crux's canonical adapter response. */
export function openAIResponse(result: ChatCompletion): AdapterResponse {
  const choice = result.choices?.[0]
  const choiceMessage = choice?.message as (OpenAI.ChatCompletionMessage & { readonly parsed?: unknown }) | undefined
  const toolCalls = choiceMessage?.tool_calls

  return {
    text:
      choiceMessage?.parsed != null
        ? typeof choiceMessage.parsed === 'string'
          ? choiceMessage.parsed
          : JSON.stringify(choiceMessage.parsed)
        : (choiceMessage?.content ?? ''),
    toolCalls:
      toolCalls && toolCalls.length > 0
        ? toolCalls
            .filter(
              (toolCall): toolCall is OpenAI.ChatCompletionMessageFunctionToolCall => toolCall.type === 'function',
            )
            .map((toolCall) => ({
              id: toolCall.id,
              name: toolCall.function.name,
              args: safeParseJson(toolCall.function.arguments),
            }))
        : undefined,
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

function safeParseJson(str: string): unknown {
  try {
    return JSON.parse(str) as unknown
  } catch {
    return str
  }
}
