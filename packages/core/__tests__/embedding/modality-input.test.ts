import { describe, expect, it } from 'vitest'
import {
  EmbeddingModalityError,
  inferModality,
  normalizeEmbeddingInput,
} from '../../src/embedding'
import { sha256Hex } from '../../src/content/sha256'

describe('embedding input', () => {
  it('normalizes bare strings as text', async () => {
    await expect(
      normalizeEmbeddingInput('a dog', {
        embeddingName: 'multimodal-test',
        supported: ['text', 'image'],
      }),
    ).resolves.toEqual({ type: 'text', text: 'a dog' })
  })

  it('normalizes typed text parts without media validation', async () => {
    await expect(
      normalizeEmbeddingInput(
        { type: 'text', text: 'a cat' },
        { embeddingName: 'text-test', supported: ['text'] },
      ),
    ).resolves.toEqual({ type: 'text', text: 'a cat' })
  })

  it.each([
    ['image/png', 'image'],
    ['audio/mpeg', 'audio'],
    ['video/mp4', 'video'],
    ['application/pdf', 'document'],
    ['text/plain', 'document'],
    [undefined, undefined],
  ] as const)('infers %s as %s', (mediaType, expected) => {
    expect(inferModality(mediaType)).toBe(expected)
  })

  it('normalizes typed byte media and records its SHA-256 identity', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4])

    const normalized = await normalizeEmbeddingInput(
      { type: 'image', source: bytes, mediaType: 'image/png' },
      { embeddingName: 'multimodal-test', supported: ['text', 'image'] },
    )

    expect(normalized).toEqual({
      type: 'image',
      asset: {
        type: 'data',
        data: bytes,
        mediaType: 'image/png',
        size: bytes.byteLength,
        sha256: sha256Hex(bytes),
      },
      sha256: sha256Hex(bytes),
    })
  })

  it('infers a bare data asset and computes a missing SHA-256 identity', async () => {
    const bytes = new Uint8Array([5, 6, 7])

    const normalized = await normalizeEmbeddingInput(
      { type: 'data', data: bytes, mediaType: 'audio/wav' },
      { embeddingName: 'multimodal-test', supported: ['text', 'audio'] },
    )

    expect(normalized).toEqual({
      type: 'audio',
      asset: {
        type: 'data',
        data: bytes,
        mediaType: 'audio/wav',
        sha256: sha256Hex(bytes),
      },
      sha256: sha256Hex(bytes),
    })
  })

  it('does not invent a SHA-256 identity for an unfetched URL', async () => {
    await expect(
      normalizeEmbeddingInput(
        {
          type: 'image',
          source: new URL('https://example.com/dog.png'),
          mediaType: 'image/png',
        },
        { embeddingName: 'multimodal-test', supported: ['image'] },
      ),
    ).resolves.toEqual({
      type: 'image',
      asset: {
        type: 'url',
        url: new URL('https://example.com/dog.png'),
        mediaType: 'image/png',
      },
    })
  })

  it('does not invent a SHA-256 identity for a provider file', async () => {
    await expect(
      normalizeEmbeddingInput(
        {
          type: 'document',
          source: {
            type: 'provider-file',
            provider: 'google',
            fileId: 'files/report',
            mediaType: 'application/pdf',
          },
        },
        { embeddingName: 'multimodal-test', supported: ['document'] },
      ),
    ).resolves.toEqual({
      type: 'document',
      asset: {
        type: 'provider-file',
        provider: 'google',
        fileId: 'files/report',
        mediaType: 'application/pdf',
      },
    })
  })

  it('rejects an unsupported modality with embedding context', async () => {
    const error = await normalizeEmbeddingInput(
      { type: 'image', source: new URL('https://example.com/dog.png'), mediaType: 'image/png' },
      { embeddingName: 'text-only', supported: ['text'] },
    ).catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(EmbeddingModalityError)
    expect(error).toMatchObject({
      embeddingName: 'text-only',
      modality: 'image',
      supported: ['text'],
    })
  })

  it('rejects raw base64 using the canonical media error', async () => {
    await expect(
      normalizeEmbeddingInput(
        { type: 'image', source: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB', mediaType: 'image/png' },
        { embeddingName: 'multimodal-test', supported: ['image'] },
      ),
    ).rejects.toThrow('Raw base64 strings are not media sources. Use a data URL or Uint8Array.')
  })

  it('rejects an AssetRef using the canonical hydration guidance', async () => {
    await expect(
      normalizeEmbeddingInput(
        { type: 'image', source: { uri: 'asset:dog' } as never, mediaType: 'image/png' },
        { embeddingName: 'multimodal-test', supported: ['image'] },
      ),
    ).rejects.toThrow('AssetRef is persistence plumbing, not model input. Hydrate it with assetStore.get(ref) first.')
  })

  it('directs ambiguous bare assets to the typed media form', async () => {
    await expect(
      normalizeEmbeddingInput(
        { type: 'url', url: new URL('https://example.com/media') },
        { embeddingName: 'multimodal-test', supported: ['image', 'document'] },
      ),
    ).rejects.toThrow('Use a typed media part such as { type: "image", source: asset }.')
  })
})
