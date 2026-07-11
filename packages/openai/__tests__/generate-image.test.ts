import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import type OpenAI from 'openai'
import { createOpenAI } from '../src'

function clientWith(response: unknown) {
  const generate = vi.fn(async (_args: unknown) => response)
  const edit = vi.fn(async (_args: unknown) => response)
  return {
    client: { images: { generate, edit } } as unknown as OpenAI,
    generate,
    edit,
  }
}

describe('OpenAI image generation', () => {
  it('performs exactly one native image generation and preserves the raw result', async () => {
    const raw = {
      created: 1,
      output_format: 'webp',
      data: [{ b64_json: 'AQI=' }, { b64_json: 'AwQ=' }],
      usage: { input_tokens: 3, output_tokens: 4, total_tokens: 7 },
    }
    const { client, generate, edit } = clientWith(raw)
    const openai = createOpenAI(client)

    const result = await openai.generateImage({
      model: 'gpt-image-1',
      prompt: 'A quiet canal',
      n: 2,
      size: '1024x1024',
      extra: { quality: 'high', output_format: 'webp' },
    })

    expect(generate).toHaveBeenCalledOnce()
    expect(edit).not.toHaveBeenCalled()
    expect(generate).toHaveBeenCalledWith({
      model: 'gpt-image-1',
      prompt: 'A quiet canal',
      n: 2,
      size: '1024x1024',
      response_format: 'b64_json',
      quality: 'high',
      output_format: 'webp',
      stream: false,
    })
    expect(result.raw).toBe(raw)
    expect(result.image).toBe(result.images[0])
    expect(result.images.map((image) => image.mediaType)).toEqual(['image/webp', 'image/webp'])
    expect(result.usage).toEqual({ inputTokens: 3, outputTokens: 4, totalTokens: 7, images: 2 })
    expect(Object.hasOwn(result, 'persist')).toBe(false)
    expectTypeOf(openai.generateImage).toBeFunction()
  })

  it('uses the native edit operation for byte references and a mask', async () => {
    const { client, generate, edit } = clientWith({ created: 1, data: [{ b64_json: 'AQI=' }] })
    const openai = createOpenAI(client)
    const image = { type: 'data' as const, data: new Uint8Array([1]), mediaType: 'image/png' }

    await openai.generateImage({
      model: 'gpt-image-1',
      prompt: { text: 'Remove the boat', images: [image], mask: image },
    })

    expect(edit).toHaveBeenCalledOnce()
    expect(generate).not.toHaveBeenCalled()
    expect(edit.mock.calls[0]?.[0]).toMatchObject({ model: 'gpt-image-1', prompt: 'Remove the boat', stream: false })
  })

  it('fails unsupported features before touching the OpenAI client', async () => {
    const { client, generate, edit } = clientWith({ created: 1, data: [] })
    const openai = createOpenAI(client)

    await expect(openai.generateImage({
      model: 'gpt-image-1',
      prompt: {
        text: 'Edit this',
        images: [{ type: 'url', url: new URL('https://example.com/a.png'), mediaType: 'image/png' }],
      },
    })).rejects.toMatchObject({ code: 'unsupported_capability' })
    expect(generate).not.toHaveBeenCalled()
    expect(edit).not.toHaveBeenCalled()
  })

  it('propagates native errors unchanged and only translates no-image successes', async () => {
    const providerError = new Error('provider failed')
    const failing = clientWith(undefined)
    failing.generate.mockRejectedValueOnce(providerError)
    await expect(createOpenAI(failing.client).generateImage({ model: 'gpt-image-1', prompt: 'x' })).rejects.toBe(providerError)

    const empty = clientWith({ created: 1, data: [] })
    await expect(createOpenAI(empty.client).generateImage({ model: 'gpt-image-1', prompt: 'x' })).rejects.toMatchObject({
      code: 'no_image_generated',
    })
  })
})
