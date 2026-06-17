import { describe, expect, it } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import type { MessageStream } from '@anthropic-ai/sdk/lib/MessageStream'
import { prompt as makePrompt } from '@crux/core'
import { createAnthropic } from '../index'

describe('Anthropic stream handling', () => {
  it('returns undefined completion metadata when finalMessage fails', async () => {
    const requests: unknown[] = []
    const client = {
      messages: {
        stream: (request: unknown) => {
          requests.push(request)
          return failingCompletionStream()
        },
      },
    } as unknown as Anthropic

    const adapter = createAnthropic(client)
    const handle = await adapter.stream(makePrompt({ id: 'anthropic-stream', prompt: 'Hello' }), {
      model: 'claude-sonnet-4-5-20250929',
    })

    expect(await handle.completion()).toBeUndefined()
    expect(requests).toHaveLength(1)
  })
})

function failingCompletionStream(): MessageStream {
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'partial' } }
    },
    finalMessage: async () => {
      throw new Error('stream closed before final message')
    },
  } as unknown as MessageStream
}
