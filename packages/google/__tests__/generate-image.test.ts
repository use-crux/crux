import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import type { GoogleGenAI } from '@google/genai'
import { imageGenerationConformanceRow } from '@use-crux/core/adapter/testing'
import { createGoogle } from '../src'

function clientWith(response: unknown) {
  const generateImages = vi.fn(async (_args: unknown) => response)
  return {
    client: { models: { generateImages } } as unknown as GoogleGenAI,
    generateImages,
  }
}

describe('Google image generation', () => {
  it('uses one native generateImages call and preserves ordered image bytes', async () => {
    expect(imageGenerationConformanceRow('google').support).toBe('native')
    const raw = {
      generatedImages: [
        {
          image: { imageBytes: 'AQI=', mimeType: 'image/png' },
          enhancedPrompt: 'Enhanced',
        },
        { image: { imageBytes: 'AwQ=', mimeType: 'image/webp' } },
      ],
      sdkHttpResponse: {
        headers: { 'x-request-id': 'req-1', authorization: 'secret' },
        responseInternal: { status: 200 },
      },
    }
    const { client, generateImages } = clientWith(raw)
    const google = createGoogle(client, { cachedContent: false })

    const result = await google.generateImage({
      model: 'imagen-4.0-generate-001',
      prompt: 'A quiet canal',
      n: 2,
      aspectRatio: '16:9',
      seed: 7,
      extra: {
        outputMimeType: 'image/webp',
        includeRaiReason: true,
        imageSize: '2K',
      },
    })

    expect(generateImages).toHaveBeenCalledOnce()
    expect(generateImages).toHaveBeenCalledWith({
      model: 'imagen-4.0-generate-001',
      prompt: 'A quiet canal',
      config: {
        abortSignal: expect.any(AbortSignal),
        numberOfImages: 2,
        aspectRatio: '16:9',
        seed: 7,
        outputMimeType: 'image/webp',
        includeRaiReason: true,
        imageSize: '2K',
      },
    })
    expect(result.raw).toBe(raw)
    expect(result.images.map((image) => image.mediaType)).toEqual(['image/png', 'image/webp'])
    expect(result.providerMetadata).toEqual({
      requestId: 'req-1',
      status: 200,
    })
    expect(result.warnings).toEqual([])
    expect(result.execution).toEqual({ kind: 'native', calls: 1 })
    expect(result).not.toHaveProperty('usage')
    expectTypeOf(google.generateImage).toBeFunction()
  })

  it('rejects known unsupported models and edit inputs before client I/O', async () => {
    const { client, generateImages } = clientWith({ generatedImages: [] })
    const google = createGoogle(client, { cachedContent: false })

    await expect(google.generateImage({ model: 'gemini-2.5-flash', prompt: 'x' })).rejects.toMatchObject({
      code: 'unsupported_capability',
    })
    await expect(
      google.generateImage({
        model: 'custom-image-model',
        prompt: {
          text: 'edit',
          images: [{ type: 'data', data: new Uint8Array([1]), mediaType: 'image/png' }],
        },
      }),
    ).rejects.toMatchObject({ code: 'unsupported_capability' })
    expect(generateImages).not.toHaveBeenCalled()
  })

  it('turns filtered/text-only successes into no-image errors and preserves native failures', async () => {
    const blocked = clientWith({
      generatedImages: [{ raiFilteredReason: 'safety policy' }],
    })
    await expect(
      createGoogle(blocked.client, { cachedContent: false }).generateImage({
        model: 'imagen-4.0-generate-001',
        prompt: 'x',
      }),
    ).rejects.toMatchObject({ code: 'no_image_generated' })

    const providerError = new Error('native failure')
    const failing = clientWith(undefined)
    failing.generateImages.mockRejectedValueOnce(providerError)
    await expect(
      createGoogle(failing.client, { cachedContent: false }).generateImage({
        model: 'custom-image-model',
        prompt: 'x',
      }),
    ).rejects.toBe(providerError)
  })
})
