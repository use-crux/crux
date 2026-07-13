import type OpenAI from 'openai'
import type { ChatCompletion, ChatCompletionChunk } from 'openai/resources/chat/completions'
import type { Stream } from 'openai/streaming'

/** Create the narrow OpenAI client double used by media boundary tests. */
export function client(overrides: Readonly<{ create?: (request: unknown) => Promise<unknown> }> = {}): OpenAI {
  const create = overrides.create ?? (async () => completion('unused'))
  return {
    chat: {
      completions: {
        create,
        parse: create,
      },
    },
  } as unknown as OpenAI
}

/** Create one deterministic chat completion for media boundary tests. */
export function completion(
  text: string,
  toolCall?: Readonly<{ id: string; name: string; arguments: string }>,
): ChatCompletion {
  return {
    id: 'chatcmpl-media',
    object: 'chat.completion',
    created: 0,
    model: 'gpt-4o',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: text || null,
          refusal: null,
          ...(toolCall
            ? {
                tool_calls: [
                  {
                    id: toolCall.id,
                    type: 'function' as const,
                    function: {
                      name: toolCall.name,
                      arguments: toolCall.arguments,
                    },
                  },
                ],
              }
            : {}),
        },
        finish_reason: toolCall ? 'tool_calls' : 'stop',
        logprobs: null,
      },
    ],
  } as ChatCompletion
}

/** Create an empty native stream for stream-request payload assertions. */
export function emptyStream(): Stream<ChatCompletionChunk> {
  return {
    async *[Symbol.asyncIterator]() {},
  } as unknown as Stream<ChatCompletionChunk>
}
