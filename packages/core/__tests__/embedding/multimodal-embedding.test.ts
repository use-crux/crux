import { describe, expect, it, vi } from 'vitest'
import {
  embedding,
  embeddingCache,
  embeddingPreprocessor,
  type NormalizedEmbeddingInput,
} from '../../src/embedding'
import { inMemoryRecordStore } from '../../src/storage'

describe('multimodal embedding execution', () => {
  it('passes normalized media inputs to the dense provider', async () => {
    const provider = vi.fn(async (inputs) => inputs.map(() => [42]))
    const dense = embedding({
      kind: 'dense',
      name: 'multimodal-test',
      dimensions: 1,
      maxInputTokens: 100,
      modalities: ['text', 'image'],
      batch: { maxSize: 2 },
      embed: provider,
    })

    await expect(
      dense.embed({ type: 'image', source: new Uint8Array([1, 2]), mediaType: 'image/png' }),
    ).resolves.toEqual([42])
    expect(provider).toHaveBeenCalledWith([
      expect.objectContaining({
        type: 'image',
        asset: expect.objectContaining({ type: 'data', mediaType: 'image/png' }),
        sha256: expect.any(String),
      }),
    ], { role: 'document' })
  })

  it('passes the requested retrieval role to every provider batch', async () => {
    const contexts: unknown[] = []
    const dense = embedding({
      kind: 'dense',
      name: 'role-test',
      dimensions: 1,
      maxInputTokens: 100,
      batch: { maxSize: 1 },
      embed: async (inputs, context) => {
        contexts.push(context)
        return inputs.map(() => [1])
      },
    })

    await dense.embedMany(['one', 'two'], { role: 'query' })

    expect(contexts).toEqual([{ role: 'query' }, { role: 'query' }])
  })

  it('rejects undeclared media before calling the dense provider', async () => {
    const provider = vi.fn(async () => [[1]])
    const dense = embedding({
      kind: 'dense',
      name: 'text-only',
      dimensions: 1,
      maxInputTokens: 100,
      batch: { maxSize: 1 },
      embed: provider,
    })

    await expect(
      dense.embed({ type: 'image', source: new Uint8Array([1]), mediaType: 'image/png' } as never),
    ).rejects.toThrow('accepts text only')
    expect(provider).not.toHaveBeenCalled()
  })

  it('skips text preprocessing, truncation, and token counting for media', async () => {
    const preprocess = vi.fn((text: string) => text)
    const countTokens = vi.fn(() => 1_000)
    const dense = embedding({
      kind: 'dense',
      name: 'media-governance',
      dimensions: 1,
      maxInputTokens: 1,
      modalities: ['image'],
      batch: { maxSize: 1 },
      preprocess: embeddingPreprocessor({ id: 'spy', run: preprocess }),
      truncate: { strategy: 'chars', maxChars: 1 },
      countTokens,
      embed: async (inputs) => inputs.map(() => [1]),
    })

    await expect(
      dense.embed({ type: 'image', source: new Uint8Array([1]), mediaType: 'image/png' }),
    ).resolves.toEqual([1])
    expect(preprocess).not.toHaveBeenCalled()
    expect(countTokens).not.toHaveBeenCalled()
  })

  it('reuses cached media vectors by data-asset SHA-256', async () => {
    const records = inMemoryRecordStore()
    const provider = vi.fn(async (inputs: readonly NormalizedEmbeddingInput[]) =>
      inputs.map(() => [7]))
    const dense = embedding({
      kind: 'dense',
      name: 'media-cache',
      dimensions: 1,
      maxInputTokens: 100,
      modalities: ['image'],
      batch: { maxSize: 2 },
      cache: embeddingCache({ records, namespace: 'media' }),
      embed: provider,
    })

    await dense.embed({ type: 'image', source: new Uint8Array([1, 2]), mediaType: 'image/png' })
    await dense.embed({ type: 'image', source: new Uint8Array([1, 2]), mediaType: 'image/png' })

    expect(provider).toHaveBeenCalledOnce()
    await expect(records.list('media:')).resolves.toMatchObject({ entries: [{ value: { kind: 'dense' } }] })
  })

  it('bypasses cache reads and writes for unfetched media URLs', async () => {
    const records = inMemoryRecordStore()
    const provider = vi.fn(async (inputs: readonly NormalizedEmbeddingInput[]) =>
      inputs.map(() => [9]))
    const dense = embedding({
      kind: 'dense',
      name: 'url-cache-bypass',
      dimensions: 1,
      maxInputTokens: 100,
      modalities: ['image'],
      batch: { maxSize: 2 },
      cache: embeddingCache({ records, namespace: 'media-url' }),
      embed: provider,
    })
    const image = {
      type: 'image' as const,
      source: new URL('https://example.com/dog.png'),
      mediaType: 'image/png',
    }

    await dense.embed(image)
    await dense.embed(image)

    expect(provider).toHaveBeenCalledTimes(2)
    await expect(records.list('media-url:')).resolves.toMatchObject({ entries: [] })
  })

  it('separates query and document cache entries when tasks affect vectors', async () => {
    const records = inMemoryRecordStore()
    const provider = vi.fn(async (inputs: readonly NormalizedEmbeddingInput[], context) =>
      inputs.map(() => [context.role === 'query' ? 1 : 2]))
    const dense = embedding({
      kind: 'dense',
      name: 'role-cache',
      dimensions: 1,
      maxInputTokens: 100,
      tasks: { query: 'QUERY', document: 'DOCUMENT' },
      batch: { maxSize: 2 },
      cache: embeddingCache({ records, namespace: 'roles' }),
      embed: provider,
    })

    await expect(dense.embed('same', { role: 'query' })).resolves.toEqual([1])
    await expect(dense.embed('same', { role: 'document' })).resolves.toEqual([2])

    expect(provider).toHaveBeenCalledTimes(2)
  })

  it('shares query and document cache entries when tasks do not affect vectors', async () => {
    const records = inMemoryRecordStore()
    const provider = vi.fn(async (inputs: readonly NormalizedEmbeddingInput[]) =>
      inputs.map(() => [3]))
    const dense = embedding({
      kind: 'dense',
      name: 'role-insensitive-cache',
      dimensions: 1,
      maxInputTokens: 100,
      batch: { maxSize: 2 },
      cache: embeddingCache({ records, namespace: 'shared-roles' }),
      embed: provider,
    })

    await dense.embed('same', { role: 'query' })
    await dense.embed('same', { role: 'document' })

    expect(provider).toHaveBeenCalledOnce()
  })
})
