import { describe, expect, it } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import type { MessageStream } from '@anthropic-ai/sdk/lib/MessageStream'
import type { CallArgs } from '@crux/core/adapter'
import { anthropicSpec } from '../index'
import type { AnthropicExtra } from '../index'

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

    const handle = await anthropicSpec.stream(client, callArgs())

    expect(await handle.completion()).toBeUndefined()
    expect(requests).toHaveLength(1)
  })
})

function callArgs(overrides: Partial<CallArgs<AnthropicExtra>> = {}): CallArgs<AnthropicExtra> {
  return {
    model: 'claude-sonnet-4-5-20250929',
    system: 'System.',
    systemBlocks: undefined,
    messages: [{ role: 'user', content: 'Hello' }],
    settings: {},
    schema: undefined,
    schemaParams: undefined,
    tools: undefined,
    extra: {},
    ...overrides,
  }
}

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
