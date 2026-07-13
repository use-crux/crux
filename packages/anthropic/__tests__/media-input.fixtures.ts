import type Anthropic from '@anthropic-ai/sdk'
import type { MessageStream } from '@anthropic-ai/sdk/lib/MessageStream'
import type { AnthropicParsedMessage } from '../src/response'

/** Create the narrow Anthropic client double used by media boundary tests. */
export function client(
  overrides: Readonly<{
    create?: (request: unknown) => Promise<unknown>
    stream?: (request: unknown) => MessageStream
  }> = {},
): Anthropic {
  const create = overrides.create ?? (async () => message('unused'))
  const stream = overrides.stream ?? (() => emptyStream())
  return {
    messages: {
      create,
      parse: create,
      stream,
    },
  } as unknown as Anthropic
}

/** Create one deterministic Anthropic response for media boundary tests. */
export function message(
  text: string,
  toolCall?: Readonly<{ id: string; name: string; input: unknown }>,
): AnthropicParsedMessage {
  return {
    id: 'msg_media',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-4-5-actual',
    content: [
      ...(text ? [{ type: 'text' as const, text }] : []),
      ...(toolCall
        ? [
            {
              type: 'tool_use' as const,
              id: toolCall.id,
              name: toolCall.name,
              input: isRecord(toolCall.input) ? toolCall.input : { value: toolCall.input },
            },
          ]
        : []),
    ],
    stop_reason: toolCall ? 'tool_use' : 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 2, output_tokens: 3 },
  } as AnthropicParsedMessage
}

/** Create an empty native stream for stream-request payload assertions. */
export function emptyStream(): MessageStream {
  return {
    async *[Symbol.asyncIterator]() {},
    finalMessage: async () => message(''),
  } as unknown as MessageStream
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
