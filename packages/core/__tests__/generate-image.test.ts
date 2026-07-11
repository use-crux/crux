import { describe, expect, expectTypeOf, it } from 'vitest'
import { z } from 'zod'
import {
  createGeneratedImageResult,
  isNoImageGeneratedError,
  lowerImagePrompt,
  prompt,
  validateGenerateImageOptions,
  type GenerateImage,
  type GenerateImageResult,
} from '../src'

describe('image generation contract', () => {
  it('lowers text and typed Crux prompts through the shared resolver', async () => {
    const caption = prompt({
      input: z.object({ subject: z.string() }),
      system: 'Create a restrained editorial illustration.',
      prompt: ({ input }) => `Subject: ${input.subject}`,
    })

    const direct = await lowerImagePrompt({ prompt: 'A quiet canal' }, { adapter: 'test', model: 'image-1' })
    const resolved = await lowerImagePrompt(
      { prompt: caption, input: { subject: 'A quiet canal' } },
      { adapter: 'test', model: 'image-1' },
    )

    expect(direct).toMatchObject({ text: 'A quiet canal', images: [] })
    expect(resolved.text).toBe('Create a restrained editorial illustration.\nSubject: A quiet canal')

    const generate = null as unknown as GenerateImage
    expectTypeOf(generate).toBeCallableWith({ model: 'image-1', prompt: caption, input: { subject: 'canal' } })
    if (false) {
      // @ts-expect-error prompt input is inferred and required
      void generate({ model: 'image-1', prompt: caption })
      // @ts-expect-error image generation has no implicit persistence option
      void generate({ model: 'image-1', prompt: 'canal', store: {} })
    }
  })

  it('aggregates unsupported resolved prompt behavior before native I/O', async () => {
    const incompatible = prompt({
      output: z.object({ title: z.string() }),
      messages: () => [{ role: 'user', content: 'Draw this.' }],
      settings: { temperature: 0.5, stopSequences: ['done'] },
    })

    await expect(
      lowerImagePrompt({ prompt: incompatible }, { adapter: 'test', model: 'image-1' }),
    ).rejects.toMatchObject({
      code: 'unsupported_capability',
      issues: expect.arrayContaining([
        expect.objectContaining({ capability: 'image.prompt.messages' }),
        expect.objectContaining({ capability: 'image.output.structured' }),
        expect.objectContaining({ capability: 'image.settings.temperature' }),
        expect.objectContaining({ capability: 'image.settings.stopSequences' }),
      ]),
    })
  })

  it('validates options and returns immediately usable ordered data assets', () => {
    const result = createGeneratedImageResult(
      [
        { data: new Uint8Array([1, 2]), mediaType: 'image/png' },
        { data: 'AwQ=', mediaType: 'image/webp' },
      ],
      { raw: { id: 'raw' }, warnings: [], execution: { kind: 'native', calls: 1 } },
    )

    expect(result.image).toBe(result.images[0])
    expect(result.images.map((image) => [...image.data as Uint8Array])).toEqual([[1, 2], [3, 4]])
    expectTypeOf(result).toMatchTypeOf<GenerateImageResult>()
    expectTypeOf(result).not.toHaveProperty('persist')
    expect(Object.hasOwn(result, 'persist')).toBe(false)
    expect(Object.hasOwn(result, 'capabilities')).toBe(false)
  })

  it('preserves a provider-native generated URL without downloading it', () => {
    const image = { type: 'url' as const, url: new URL('https://cdn.example/image.png'), mediaType: 'image/png' }
    const result = createGeneratedImageResult([image], {
      raw: { id: 'raw' },
      warnings: [],
      execution: { kind: 'native', calls: 1 },
    })

    expect(result.image).toBe(image)
    expect(result.images).toEqual([image])
  })

  it('rejects malformed portable controls', () => {
    for (const options of [
      { n: 0 },
      { n: 1.5 },
      { size: '1024' },
      { aspectRatio: '16:0' },
      { seed: -1 },
      { timeout: { stepMs: 0 } },
    ]) {
      expect(() => validateGenerateImageOptions(options)).toThrow()
    }
  })

  it('tags malformed or empty native successes as no-image errors with a cause', () => {
    for (const images of [[], [{ data: '', mediaType: 'image/png' }], [{ data: '***', mediaType: 'image/png' }]]) {
      try {
        createGeneratedImageResult(images, { raw: { ok: true }, warnings: [], execution: { kind: 'native', calls: 1 } })
        throw new Error('expected validation to fail')
      } catch (error) {
        expect(isNoImageGeneratedError(error)).toBe(true)
        expect((error as Error).cause).toBeDefined()
      }
    }
  })
})
