import type { ChatCompletionChunk } from 'openai/resources/chat/completions'

/** Extract a text delta from an OpenAI chat-completion stream chunk. */
export function openAITextDelta(chunk: unknown): string | undefined {
  if (!isRecord(chunk) || !Array.isArray(chunk.choices)) return undefined
  const firstChoice = chunk.choices[0]
  if (!isRecord(firstChoice) || !isRecord(firstChoice.delta)) return undefined
  const content = firstChoice.delta.content
  return typeof content === 'string' ? content : undefined
}

/** Compile-time alias used by native chat stream bindings. */
export type OpenAIChatStreamChunk = ChatCompletionChunk

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
