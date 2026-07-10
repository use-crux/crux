import { describe, expect, it, vi } from 'vitest'
import { prompt, type Message } from '@use-crux/core'
import { createOpenAI } from '../src'
import { client, completion, emptyStream } from './media-input.fixtures'

const mediaPrompt = prompt({
  id: 'openai-media-input-modes',
  prompt: 'Inspect the supplied media.',
})

describe('OpenAI media call-mode parity', () => {
  it('lowers the same media request for prepare, transport, and stream modes', async () => {
    const options: { readonly model: 'gpt-4o'; readonly messages: Message[] } = {
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: new Uint8Array([1, 2, 3]),
              mediaType: 'image/png',
            },
          ],
        },
      ],
    }
    const managedCalls: unknown[] = []
    await createOpenAI(
      client({
        create: vi.fn(async (request) => {
          managedCalls.push(request)
          return completion('done')
        }),
      }),
    ).generate(mediaPrompt, options)

    const prepared = await createOpenAI(client()).prepare!(mediaPrompt, options)
    const transportCalls: unknown[] = []
    await createOpenAI(client()).generate(mediaPrompt, {
      ...options,
      transport: async (request) => {
        transportCalls.push(request)
        return completion('done')
      },
    })

    const streamCalls: unknown[] = []
    await createOpenAI(
      client({
        create: vi.fn(async (request) => {
          streamCalls.push(request)
          return emptyStream()
        }),
      }),
    ).stream(mediaPrompt, options)

    expect(prepared.params).toEqual(managedCalls[0])
    expect(transportCalls[0]).toEqual(managedCalls[0])
    expect(streamCalls[0]).toEqual({
      ...(managedCalls[0] as object),
      stream: true,
    })
  })
})
