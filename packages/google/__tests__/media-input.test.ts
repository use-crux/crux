import { describe, expect, it, vi } from 'vitest'
import { isInvalidMediaSourceError, isUnsupportedCapabilityError, prompt, tool } from '@use-crux/core'
import {
  assertDirectMediaTranscriptIdentity,
  directMediaFixture,
  mediaConformanceFixture,
  wrongProviderFileMessages,
} from '@use-crux/core/adapter/testing'
import { z } from 'zod'
import { createGoogle } from '../src'
import type { Message } from '@use-crux/core'
import { client, emptyStream, response } from './media-input.fixtures'

const mediaPrompt = prompt({
  id: 'google-media-input',
  prompt: 'Inspect the supplied media.',
})

describe('Google native media input', () => {
  it('lowers mixed URL, data, and provider-file input at the public generate boundary', async () => {
    const fixture = directMediaFixture('google')
    const generateContent = vi.fn(async (_request: unknown) => response('done'))

    const result = await createGoogle(client({ generateContent }), {
      cachedContent: false,
    }).generate(mediaPrompt, {
      model: 'gemini-2.5-flash',
      messages: [...fixture.messages],
    })

    expect(generateContent).toHaveBeenCalledOnce()
    expect(generateContent.mock.calls[0]![0]).toMatchObject({
      model: 'gemini-2.5-flash',
      contents: [
        {
          role: 'user',
          parts: [
            { text: 'Compare these.' },
            {
              fileData: {
                fileUri: fixture.imageUrl.href,
                mimeType: 'image/png',
              },
              mediaResolution: { level: 'MEDIA_RESOLUTION_LOW' },
            },
            {
              inlineData: {
                data: 'BAUG',
                mimeType: 'application/pdf',
                displayName: 'quarterly.pdf',
              },
            },
            {
              fileData: {
                fileUri: fixture.providerFileId,
                mimeType: 'application/pdf',
                displayName: 'uploaded.pdf',
              },
            },
          ],
        },
      ],
    })
    assertDirectMediaTranscriptIdentity(result, fixture.messages)
  })

  it('lowers media returned by a tool before the next provider turn', async () => {
    const source = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })
    const readSource = vi.spyOn(source, 'arrayBuffer')
    const generateContent = vi
      .fn()
      .mockResolvedValueOnce(response('', { id: 'call_render', name: 'render', args: {} }))
      .mockResolvedValueOnce(response('described'))
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
      id: 'google-tool-media',
      prompt: 'Render and inspect a chart.',
      tools: { render },
    })

    const result = await createGoogle(client({ generateContent }), {
      cachedContent: false,
    }).generate(toolPrompt, {
      model: 'gemini-2.5-flash',
      maxSteps: 2,
    })

    expect(result.text).toBe('described')
    expect(generateContent).toHaveBeenCalledTimes(2)
    expect(readSource).toHaveBeenCalledOnce()
    expect(generateContent.mock.calls[1]![0]).toMatchObject({
      contents: [
        { role: 'user', parts: [{ text: 'Render and inspect a chart.' }] },
        expect.objectContaining({ role: 'model' }),
        {
          role: 'user',
          parts: [
            {
              functionResponse: {
                id: 'call_render',
                response: {
                  output: 'Rendered chart.\n[image image/png 3B sha256:039058c6f2c0]',
                },
                parts: [{ inlineData: { data: 'AQID', mimeType: 'image/png' } }],
              },
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

  it('preflights unsupported models and wrong-provider files before I/O', async () => {
    const fixture = mediaConformanceFixture('google')
    let resolved = false
    const resolvingPrompt = prompt({
      id: 'google-preflight-order',
      prompt: () => {
        resolved = true
        return 'Inspect.'
      },
    })
    const generateContent = vi.fn(async () => response('unexpected'))
    const adapter = createGoogle(client({ generateContent }), {
      cachedContent: false,
    })

    await expect(
      adapter.generate(resolvingPrompt, {
        model: 'text-bison-001',
        messages: [...fixture.knownUnsupported],
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(resolved).toBe(true)
      expect(isUnsupportedCapabilityError(error)).toBe(true)
      expect(error).toMatchObject({
        adapter: 'google',
        model: 'text-bison-001',
        capability: 'input.image',
        path: 'messages[0].content[0].source',
      })
      expect(error).toMatchObject({ issues: expect.arrayContaining([expect.objectContaining({ capability: 'input.file' })]) })
      return true
    })

    await expect(
      adapter.generate(mediaPrompt, {
        model: 'gemini-2.5-flash',
        messages: [...wrongProviderFileMessages('google')],
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(isInvalidMediaSourceError(error)).toBe(true)
      expect(error).toMatchObject({ path: 'messages[0].content[0].source' })
      expect(String(error)).not.toContain('wrong-provider-secret')
      return true
    })

    expect(generateContent).not.toHaveBeenCalled()
  })

  it('allows unknown custom model ids instead of guessing their media capabilities', async () => {
    const generateContent = vi.fn(async () => response('done'))

    await createGoogle(client({ generateContent }), { cachedContent: false }).generate(mediaPrompt, {
      model: mediaConformanceFixture('google').unknownModel,
      messages: [
        {
          role: 'user',
          content: [{ type: 'image', source: 'https://example.com/image.png', mediaType: 'image/png' }],
        },
      ],
    })

    expect(generateContent).toHaveBeenCalledOnce()
  })

  it('lowers the same media request for prepare, transport, and stream modes', async () => {
    const options: { readonly model: string; readonly messages: Message[] } = {
      model: 'gemini-2.5-flash',
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
    await createGoogle(
      client({
        generateContent: vi.fn(async (request) => {
          managedCalls.push(request)
          return response('done')
        }),
      }),
      { cachedContent: false },
    ).generate(mediaPrompt, options)

    const prepared = await createGoogle(client(), { cachedContent: false }).prepare!(mediaPrompt, options)
    const transportCalls: unknown[] = []
    await createGoogle(client(), { cachedContent: false }).generate(mediaPrompt, {
      ...options,
      transport: async (request) => {
        transportCalls.push(request)
        return response('done')
      },
    })
    const streamCalls: unknown[] = []
    await createGoogle(
      client({
        generateContentStream: vi.fn(async (request) => {
          streamCalls.push(request)
          return emptyStream()
        }),
      }),
      { cachedContent: false },
    ).stream(mediaPrompt, options)

    expect(prepared.params).toEqual(managedCalls[0])
    expect(transportCalls[0]).toEqual(managedCalls[0])
    expect(streamCalls[0]).toEqual(managedCalls[0])
  })
})
