import type OpenAI from 'openai'
import type { ChatCompletion, ChatCompletionChunk } from 'openai/resources/chat/completions'
import type { Stream } from 'openai/streaming'
import { describe, expect, it, vi } from 'vitest'
import { isInvalidMediaSourceError, isUnsupportedCapabilityError, prompt, tool } from '@use-crux/core'
import { z } from 'zod'
import { createOpenAI } from '../src'
import type { Message } from '@use-crux/core'

const mediaPrompt = prompt({
  id: 'openai-media-input',
  prompt: 'Inspect the supplied media.',
})

describe('OpenAI native media input', () => {
  it('lowers mixed URL, data, and provider-file input at the public generate boundary', async () => {
    const create = vi.fn(async (_request: unknown) => completion('done'))
    const adapter = createOpenAI(client({ create }))
    const imageUrl = new URL('https://example.com/chart.png?token=secret')
    const inputMessages = [
      {
        role: 'user' as const,
        content: [
          { type: 'text' as const, text: 'Compare these.' },
          {
            type: 'image' as const,
            source: imageUrl,
            mediaType: 'image/png',
            providerOptions: { openai: { detail: 'high' as const } },
          },
          {
            type: 'file' as const,
            source: new Uint8Array([1, 2, 3]),
            mediaType: 'application/pdf',
            filename: 'quarterly.pdf',
          },
          {
            type: 'file' as const,
            source: {
              type: 'provider-file' as const,
              provider: 'openai',
              fileId: 'file-safe-id',
              mediaType: 'application/pdf',
              filename: 'uploaded.pdf',
            },
          },
        ],
      },
    ] satisfies Message[]

    const result = await adapter.generate(mediaPrompt, {
      model: 'gpt-4o',
      messages: inputMessages,
    })

    expect(create).toHaveBeenCalledOnce()
    expect(create.mock.calls[0]![0]).toMatchObject({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Compare these.' },
            {
              type: 'image_url',
              image_url: { url: imageUrl.href, detail: 'high' },
            },
            {
              type: 'file',
              file: {
                file_data: 'data:application/pdf;base64,AQID',
                filename: 'quarterly.pdf',
              },
            },
            { type: 'file', file: { file_id: 'file-safe-id' } },
          ],
        },
      ],
    })
    expect(result.messages[0]).toBe(inputMessages[0])
  })

  it('lowers media returned by a tool immediately before the next provider turn', async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce(
        completion('', {
          id: 'call-render',
          name: 'render',
          arguments: '{}',
        }),
      )
      .mockResolvedValueOnce(completion('described'))
    const render = tool({
      description: 'Render a chart.',
      input: z.object({}),
      execute: async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
      toModelOutput: ({ output }) => ({
        type: 'content',
        value: [
          { type: 'text', text: 'Rendered chart.' },
          { type: 'image', source: output, mediaType: 'image/png' },
        ],
      }),
    })
    const adapter = createOpenAI(client({ create }))
    const toolPrompt = prompt({
      id: 'openai-tool-media',
      prompt: 'Render and inspect a chart.',
      tools: { render },
    })

    const result = await adapter.generate(toolPrompt, {
      model: 'gpt-4o',
      maxSteps: 2,
    })

    expect(result.text).toBe('described')
    expect(create).toHaveBeenCalledTimes(2)
    expect(create.mock.calls[1]![0]).toMatchObject({
      messages: [
        { role: 'user', content: 'Render and inspect a chart.' },
        expect.objectContaining({ role: 'assistant' }),
        {
          role: 'tool',
          content: expect.stringContaining('Rendered chart.'),
          tool_call_id: 'call-render',
        },
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: 'data:image/png;base64,AQID' },
            },
          ],
        },
      ],
    })
    const canonicalTool = result.messages.find((message) => message.role === 'tool')
    expect(canonicalTool?.content).toEqual([
      { type: 'text', text: 'Rendered chart.' },
      expect.objectContaining({ type: 'image', source: expect.any(Blob) }),
    ])
  })

  it('preflights exact model, media, and path after prompt resolution and before I/O', async () => {
    let resolved = false
    const resolvingPrompt = prompt({
      id: 'openai-preflight-order',
      prompt: () => {
        resolved = true
        return 'Inspect.'
      },
    })
    const create = vi.fn(async () => completion('unexpected'))

    await expect(
      createOpenAI(client({ create })).generate(resolvingPrompt, {
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Inspect this.' },
              {
                type: 'image',
                source: 'https://example.com/private.png',
                mediaType: 'image/png',
              },
            ],
          },
        ],
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(resolved).toBe(true)
      expect(isUnsupportedCapabilityError(error)).toBe(true)
      expect(error).toMatchObject({
        adapter: 'openai',
        model: 'gpt-3.5-turbo',
        capability: 'input.image',
        path: 'messages[0].content[1].source',
        mediaType: 'image/png',
      })
      expect(String(error)).not.toContain('private.png')
      return true
    })
    expect(create).not.toHaveBeenCalled()
  })

  it('rejects wrong-provider files and malformed data without starting I/O', async () => {
    const create = vi.fn(async () => completion('unexpected'))
    const adapter = createOpenAI(client({ create }))

    await expect(
      adapter.generate(mediaPrompt, {
        model: 'gpt-4o',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'file',
                source: {
                  type: 'provider-file',
                  provider: 'google',
                  fileId: 'secret-file',
                },
              },
            ],
          },
        ],
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(isInvalidMediaSourceError(error)).toBe(true)
      expect(error).toMatchObject({ path: 'messages[0].content[0].source' })
      expect(String(error)).not.toContain('secret-file')
      return true
    })

    await expect(
      adapter.generate(mediaPrompt, {
        model: 'gpt-4o',
        messages: [
          {
            role: 'user',
            content: [{ type: 'image', source: 'data:image/png;base64,%%%bad' }],
          },
        ],
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(isInvalidMediaSourceError(error)).toBe(true)
      expect(error).toMatchObject({ path: 'messages[0].content[0].source' })
      expect(String(error)).not.toContain('%%%bad')
      return true
    })

    expect(create).not.toHaveBeenCalled()
  })

  it('rejects native-unsupported file URLs before a custom transport is called', async () => {
    const transport = vi.fn(async () => completion('unexpected'))

    await expect(
      createOpenAI(client()).generate(mediaPrompt, {
        model: 'gpt-4o',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Read this.' },
              {
                type: 'file',
                source: 'https://example.com/private.pdf?token=secret',
                mediaType: 'application/pdf',
              },
            ],
          },
        ],
        transport,
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(isUnsupportedCapabilityError(error)).toBe(true)
      expect(error).toMatchObject({
        adapter: 'openai',
        model: 'gpt-4o',
        capability: 'input.file',
        path: 'messages[0].content[1].source',
        mediaType: 'application/pdf',
      })
      expect(String(error)).not.toContain('private.pdf')
      expect(String(error)).not.toContain('secret')
      return true
    })
    expect(transport).not.toHaveBeenCalled()
  })

  it('passes actual OpenAI SDK failures through unchanged once I/O starts', async () => {
    const sdkError = new Error('native SDK failure')
    const adapter = createOpenAI(client({ create: vi.fn(async () => Promise.reject(sdkError)) }))

    await expect(adapter.generate(mediaPrompt, { model: 'gpt-4o' })).rejects.toBe(sdkError)
  })

  it('lowers the same media request for prepare, transport, and stream modes', async () => {
    const options: { readonly model: 'gpt-4o'; readonly messages: Message[] } = {
      model: 'gpt-4o',
      messages: [
        {
          role: 'user' as const,
          content: [
            {
              type: 'image' as const,
              source: new Uint8Array([1, 2, 3]),
              mediaType: 'image/png',
            },
          ],
        },
      ],
    }
    const managedCalls: unknown[] = []
    const managed = createOpenAI(
      client({
        create: vi.fn(async (request) => {
          managedCalls.push(request)
          return completion('done')
        }),
      }),
    )
    await managed.generate(mediaPrompt, options)

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

function client(overrides: Readonly<{ create?: (request: unknown) => Promise<unknown> }> = {}): OpenAI {
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

function completion(
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

function emptyStream(): Stream<ChatCompletionChunk> {
  return {
    async *[Symbol.asyncIterator]() {},
  } as unknown as Stream<ChatCompletionChunk>
}
