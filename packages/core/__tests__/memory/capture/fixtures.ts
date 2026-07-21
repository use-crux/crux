import { adapter as makeAdapter } from '../../../src/adapter/define-adapter'
import type { AdapterResponse } from '../../../src/adapter/types'

function mockResponse(
  text: string,
  toolCalls?: AdapterResponse['toolCalls'],
): AdapterResponse {
  return {
    text,
    toolCalls,
    usage: {
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
      inputTokenDetails: {},
      outputTokenDetails: {},
    },
    finishReason: 'stop',
    responseId: 'response-1',
    actualModelId: 'model-1',
  }
}

/** Create a deterministic adapter for memory-capture behavior tests. */
export function testAdapter(
  text = 'assistant answer',
  firstToolCalls?: AdapterResponse['toolCalls'],
) {
  let callCount = 0
  return makeAdapter({
    providerId: 'test',
    async call() {
      return {
        raw: { id: 'raw-1' },
        extracted:
          callCount++ === 0 && firstToolCalls
            ? mockResponse('', firstToolCalls)
            : mockResponse(text),
      }
    },
    async stream() {
      async function* chunks() {
        yield { text }
      }
      return {
        rawStream: chunks(),
        extractTextDelta: (chunk) => (chunk as { text: string }).text,
        completion: async () => ({
          usage: {
            inputTokens: 1,
            outputTokens: 1,
            totalTokens: 2,
            inputTokenDetails: {},
            outputTokenDetails: {},
          },
        }),
      }
    },
    appendToolRound(messages, response, toolResults) {
      return [
        ...messages,
        { role: 'assistant' as const, content: response.text },
        ...toolResults.map((result) => ({
          role: 'tool' as const,
          content: result.content,
        })),
      ]
    },
    mapSettings(settings) {
      return settings
    },
  })({})
}
