import { describe, expect, it, vi } from 'vitest'
import { isInvalidMediaSourceError, isUnsupportedCapabilityError, prompt, tool } from '@use-crux/core'
import {
  assertDirectMediaTranscriptIdentity,
  directMediaFixture,
  wrongProviderFileMessages,
} from '@use-crux/core/adapter/testing'
import { z } from 'zod'
import { createAnthropic } from '../src'
import type { Message } from '@use-crux/core'
import { client, emptyStream, message } from './media-input.fixtures'

const mediaPrompt = prompt({
  id: 'anthropic-media-input',
  prompt: 'Inspect the supplied media.',
})

describe('Anthropic native media input', () => {
  it('lowers URL and data media at the public generate boundary', async () => {
    const fixture = directMediaFixture('anthropic')
    const fixtureContent = fixture.messages[0]!.content
    const messages = [
      {
        ...fixture.messages[0]!,
        content: Array.isArray(fixtureContent) ? fixtureContent.slice(0, 3) : fixtureContent,
      },
    ] satisfies Message[]
    const create = vi.fn(async (_request: unknown) => message('done'))

    const result = await createAnthropic(client({ create })).generate(mediaPrompt, {
      model: 'claude-sonnet-4-5-20250929',
      messages,
    })

    expect(create).toHaveBeenCalledOnce()
    expect(create.mock.calls[0]![0]).toMatchObject({
      model: 'claude-sonnet-4-5-20250929',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Compare these.' },
            {
              type: 'image',
              source: { type: 'url', url: fixture.imageUrl.href },
              cache_control: { type: 'ephemeral' },
            },
            {
              type: 'document',
              source: {
                type: 'base64',
                data: 'BAUG',
                media_type: 'application/pdf',
              },
              title: 'quarterly.pdf',
            },
          ],
        },
      ],
    })
    assertDirectMediaTranscriptIdentity(result, messages)
  })

  it('lowers media returned by a tool before the next provider turn', async () => {
    const source = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })
    const readSource = vi.spyOn(source, 'arrayBuffer')
    const create = vi
      .fn()
      .mockResolvedValueOnce(message('', { id: 'call_render', name: 'render', input: {} }))
      .mockResolvedValueOnce(message('described'))
    const render = tool({
      description: 'Render a chart.',
      input: z.object({}),
      execute: async () => source,
      toModelOutput: ({ output }) => ({
        type: 'content',
        value: [
          { type: 'text', text: 'Rendered chart.' },
          { type: 'image', source: output, mediaType: 'image/png' },
        ],
      }),
    })
    const toolPrompt = prompt({
      id: 'anthropic-tool-media',
      prompt: 'Render and inspect a chart.',
      tools: { render },
    })

    const result = await createAnthropic(client({ create })).generate(toolPrompt, {
      model: 'claude-sonnet-4-5-20250929',
      maxSteps: 2,
    })

    expect(result.text).toBe('described')
    expect(create).toHaveBeenCalledTimes(2)
    expect(readSource).toHaveBeenCalledOnce()
    expect(create.mock.calls[1]![0]).toMatchObject({
      messages: [
        { role: 'user', content: 'Render and inspect a chart.' },
        expect.objectContaining({ role: 'assistant' }),
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'call_render',
              content: [
                { type: 'text', text: 'Rendered chart.' },
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    data: 'AQID',
                    media_type: 'image/png',
                  },
                },
              ],
            },
          ],
        },
      ],
    })
    const canonicalTool = result.messages.find((item) => item.role === 'tool')
    expect(canonicalTool?.content).toEqual([
      { type: 'text', text: 'Rendered chart.' },
      expect.objectContaining({ type: 'image', source: expect.any(Blob) }),
    ])
  })

  it('preflights unsupported models, provider-file input, and wrong providers before I/O', async () => {
    let resolved = false
    const resolvingPrompt = prompt({
      id: 'anthropic-preflight-order',
      prompt: () => {
        resolved = true
        return 'Inspect.'
      },
    })
    const create = vi.fn(async () => message('unexpected'))
    const adapter = createAnthropic(client({ create }))

    await expect(
      adapter.generate(resolvingPrompt, {
        model: 'claude-2.1',
        messages: [
          {
            role: 'user',
            content: [{ type: 'image', source: 'https://example.com/private.png' }],
          },
        ],
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(resolved).toBe(true)
      expect(isUnsupportedCapabilityError(error)).toBe(true)
      expect(error).toMatchObject({
        adapter: 'anthropic',
        model: 'claude-2.1',
        capability: 'input.image',
        path: 'messages[0].content[0].source',
      })
      expect(String(error)).not.toContain('private.png')
      return true
    })

    await expect(
      adapter.generate(mediaPrompt, {
        model: 'claude-sonnet-4-5-20250929',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'file',
                source: {
                  type: 'provider-file',
                  provider: 'anthropic',
                  fileId: 'file-secret',
                  mediaType: 'application/pdf',
                },
              },
            ],
          },
        ],
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(isUnsupportedCapabilityError(error)).toBe(true)
      expect(error).toMatchObject({
        adapter: 'anthropic',
        capability: 'input.file.provider-file',
        path: 'messages[0].content[0].source',
      })
      expect(String(error)).not.toContain('file-secret')
      return true
    })

    await expect(
      adapter.generate(mediaPrompt, {
        model: 'claude-sonnet-4-5-20250929',
        messages: [...wrongProviderFileMessages('anthropic')],
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(isInvalidMediaSourceError(error)).toBe(true)
      expect(error).toMatchObject({ path: 'messages[0].content[0].source' })
      expect(String(error)).not.toContain('wrong-provider-secret')
      return true
    })

    expect(create).not.toHaveBeenCalled()
  })

  it('allows unknown custom model ids instead of guessing their media capabilities', async () => {
    const create = vi.fn(async () => message('done'))

    await createAnthropic(client({ create })).generate(mediaPrompt, {
      model: 'custom-claude-media-router',
      messages: [
        {
          role: 'user',
          content: [{ type: 'image', source: 'https://example.com/image.png', mediaType: 'image/png' }],
        },
      ],
    })

    expect(create).toHaveBeenCalledOnce()
  })

  it('lowers the same media request for prepare, transport, and stream modes', async () => {
    const fixture = directMediaFixture('anthropic')
    const options: { readonly model: string; readonly messages: Message[] } = {
      model: 'claude-sonnet-4-5-20250929',
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
    await createAnthropic(
      client({
        create: vi.fn(async (request) => {
          managedCalls.push(request)
          return message('done')
        }),
      }),
    ).generate(mediaPrompt, options)

    const prepared = await createAnthropic(client()).prepare!(mediaPrompt, options)
    const transportCalls: unknown[] = []
    await createAnthropic(client()).generate(mediaPrompt, {
      ...options,
      transport: async (request) => {
        transportCalls.push(request)
        return message('done')
      },
    })
    const streamCalls: unknown[] = []
    await createAnthropic(
      client({
        stream: vi.fn((request) => {
          streamCalls.push(request)
          return emptyStream()
        }),
      }),
    ).stream(mediaPrompt, options)

    expect(prepared.params).toEqual(managedCalls[0])
    expect(transportCalls[0]).toEqual(managedCalls[0])
    expect(streamCalls[0]).toEqual(managedCalls[0])
    expect(JSON.stringify(managedCalls[0])).not.toContain(fixture.providerFileId)
  })
})
