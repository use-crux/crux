import { describe, expect, it, vi } from 'vitest'
import {
  embedding as makeEmbedding,
  embeddingCache,
  normalizeText,
  type SparseVector,
} from '../../embedding'
import { resetHooks, updateHooks } from '../../runtime/runtime'
import { inMemoryRecordStore } from '../../storage'

describe('embedding', () => {
  it('creates a dense embedding with single and batch helpers', async () => {
    const embed = vi.fn(async (texts: string[]) => texts.map((text) => [text.length, text.length + 1]))

    const embedding = makeEmbedding({
      kind: 'dense',
      name: 'dense-test',
      dimensions: 2,
      maxInputTokens: 100,
      batch: { maxSize: 2 },
      embed,
    })

    await expect(embedding.embed('hello')).resolves.toEqual([5, 6])
    await expect(embedding.embedMany(['a', 'bb', 'ccc'])).resolves.toEqual([
      [1, 2],
      [2, 3],
      [3, 4],
    ])

    expect(embed).toHaveBeenNthCalledWith(1, ['hello'])
    expect(embed).toHaveBeenNthCalledWith(2, ['a', 'bb'])
    expect(embed).toHaveBeenNthCalledWith(3, ['ccc'])
    expect(embedding.asEmbedFn()).toBe(embedding.embed)
  })

    it('creates a sparse embedding with single and batch helpers', async () => {
    const embed = vi.fn(async (texts: string[]) =>
      texts.map(
        (text): SparseVector => ({
          indices: text.split('').map((_, index) => index),
          values: text.split('').map((char) => char.charCodeAt(0)),
        }),
      ),
    )

    const embedding = makeEmbedding({
      kind: 'sparse',
      name: 'sparse-test',
      maxInputTokens: 100,
      batch: { maxSize: 2 },
      embed,
    })

    await expect(embedding.embed('ab')).resolves.toEqual({ indices: [0, 1], values: [97, 98] })
    await expect(embedding.embedMany(['a', 'bc'])).resolves.toEqual([
      { indices: [0], values: [97] },
      { indices: [0, 1], values: [98, 99] },
    ])
  })

    it('preserves order across concurrent batches', async () => {
    let active = 0
    let maxActive = 0

    const embedding = makeEmbedding({
      kind: 'dense',
      name: 'concurrent-dense',
      dimensions: 1,
      maxInputTokens: 100,
      batch: { maxSize: 2, concurrency: 2 },
      embed: async (texts) => {
        active++
        maxActive = Math.max(maxActive, active)
        await new Promise((resolve) => setTimeout(resolve, 10))
        active--
        return texts.map((text) => [Number(text)])
      },
    })

    await expect(embedding.embedMany(['1', '2', '3', '4', '5'])).resolves.toEqual([[1], [2], [3], [4], [5]])
    expect(maxActive).toBeLessThanOrEqual(2)
  })

    it('supports provider metadata for dense batches', async () => {
    const embedding = makeEmbedding({
      kind: 'dense',
      name: 'dense-meta',
      dimensions: 2,
      maxInputTokens: 100,
      batch: { maxSize: 10 },
      embed: async (texts) => ({
        embeddings: texts.map((text) => [text.length, text.length]),
        usage: { inputTokens: 12, totalTokens: 12 },
        cost: 0.01,
      }),
    })

    await expect(embedding.embedMany(['aa', 'bbb'])).resolves.toEqual([
      [2, 2],
      [3, 3],
    ])
  })

    it('supports provider metadata for sparse batches', async () => {
    const embedding = makeEmbedding({
      kind: 'sparse',
      name: 'sparse-meta',
      maxInputTokens: 100,
      batch: { maxSize: 10 },
      embed: async (texts) => ({
        embeddings: texts.map((text) => ({
          indices: [0],
          values: [text.length],
        })),
        usage: { inputTokens: 2, totalTokens: 2 },
        cost: 0.02,
      }),
    })

    await expect(embedding.embedMany(['aa', 'bbb'])).resolves.toEqual([
      { indices: [0], values: [2] },
      { indices: [0], values: [3] },
    ])
  })

    it('short-circuits empty batches', async () => {
    const embed = vi.fn(async (_texts: string[]) => [[1]])
    const embedding = makeEmbedding({
      kind: 'dense',
      name: 'empty-dense',
      dimensions: 1,
      maxInputTokens: 100,
      batch: { maxSize: 2 },
      embed,
    })

    await expect(embedding.embedMany([])).resolves.toEqual([])
    expect(embed).not.toHaveBeenCalled()
  })

    it('throws for invalid dense config', () => {
    expect(() =>
      makeEmbedding({
        kind: 'dense',
        name: '',
        dimensions: 0,
        maxInputTokens: 0,
        batch: { maxSize: 0, concurrency: 0 },
        embed: async () => [],
      }),
    ).toThrow()
  })

    it('throws for invalid sparse config', () => {
    expect(() =>
      makeEmbedding({
        kind: 'sparse',
        name: '',
        maxInputTokens: 0,
        batch: { maxSize: 0, concurrency: 0 },
        embed: async () => [],
      }),
    ).toThrow()
  })

    it('returns a frozen object', () => {
    const embedding = makeEmbedding({
      kind: 'dense',
      name: 'frozen',
      dimensions: 1,
      maxInputTokens: 100,
      batch: { maxSize: 1 },
      embed: async () => [[1]],
    })

    expect(Object.isFrozen(embedding)).toBe(true)
    expect(embedding._tag).toBe('Embedding')
  })

    it('preprocesses inputs before calling the provider', async () => {
    const embed = vi.fn(async (texts: string[]) => texts.map((text) => [text.length]))
    const dense = makeEmbedding({
      kind: 'dense',
      name: 'preprocessed',
      dimensions: 1,
      maxInputTokens: 100,
      batch: { maxSize: 10 },
      preprocess: normalizeText({ trim: true, collapseWhitespace: true, lowercase: true }),
      embed,
    })

    await expect(dense.embedMany(['  Hello   WORLD  '])).resolves.toEqual([[11]])
    expect(embed).toHaveBeenCalledWith(['hello world'])
  })

    it('fails over-limit inputs by default before calling the provider', async () => {
    const embed = vi.fn(async (texts: string[]) => texts.map((text) => [text.length]))
    const dense = makeEmbedding({
      kind: 'dense',
      name: 'fail-limit',
      dimensions: 1,
      maxInputTokens: 2,
      batch: { maxSize: 10 },
      countTokens: (text) => text.split(/\s+/).filter(Boolean).length,
      embed,
    })

    await expect(dense.embed('one two three')).rejects.toThrow('exceeds maxInputTokens')
    expect(embed).not.toHaveBeenCalled()
  })

    it('caches normalized dense inputs while preserving output order', async () => {
    const records = inMemoryRecordStore()
    const embed = vi.fn(async (texts: string[]) => texts.map((text) => [text.length]))
    const dense = makeEmbedding({
      kind: 'dense',
      name: 'cached-dense',
      dimensions: 1,
      maxInputTokens: 100,
      batch: { maxSize: 10 },
      preprocess: normalizeText({ trim: true, collapseWhitespace: true }),
      cache: embeddingCache({ records, namespace: 'embeddings' }),
      embed,
    })

    await expect(dense.embedMany([' alpha ', 'beta', 'alpha'])).resolves.toEqual([[5], [4], [5]])
    await expect(dense.embedMany(['alpha', ' beta '])).resolves.toEqual([[5], [4]])
    expect(embed).toHaveBeenCalledTimes(1)
    expect(embed).toHaveBeenCalledWith(['alpha', 'beta'])
  })

    it('keeps cache keys separate when preprocessing policy changes', async () => {
    const records = inMemoryRecordStore()
    const upperEmbed = vi.fn(async (texts: string[]) => texts.map((text) => [text.charCodeAt(0)]))
    const lowerEmbed = vi.fn(async (texts: string[]) => texts.map((text) => [text.charCodeAt(0)]))

    const upper = makeEmbedding({
      kind: 'dense',
      name: 'same-name',
      dimensions: 1,
      maxInputTokens: 100,
      batch: { maxSize: 10 },
      preprocess: normalizeText({ trim: true }),
      cache: embeddingCache({ records, namespace: 'embeddings' }),
      embed: upperEmbed,
    })
    const lower = makeEmbedding({
      kind: 'dense',
      name: 'same-name',
      dimensions: 1,
      maxInputTokens: 100,
      batch: { maxSize: 10 },
      preprocess: normalizeText({ trim: true, lowercase: true }),
      cache: embeddingCache({ records, namespace: 'embeddings' }),
      embed: lowerEmbed,
    })

    await expect(upper.embed(' Alpha ')).resolves.toEqual([65])
    await expect(lower.embed(' Alpha ')).resolves.toEqual([97])
    expect(upperEmbed).toHaveBeenCalledTimes(1)
    expect(lowerEmbed).toHaveBeenCalledTimes(1)
  })

    it('retries failed provider batches and preserves order', async () => {
    let attempts = 0
    const dense = makeEmbedding({
      kind: 'dense',
      name: 'retry-dense',
      dimensions: 1,
      maxInputTokens: 100,
      batch: { maxSize: 2 },
      retry: { maxAttempts: 2, baseDelayMs: 0 },
      embed: async (texts) => {
        attempts++
        if (attempts === 1) {
          throw new Error('temporary')
        }
        return texts.map((text) => [Number(text)])
      },
    })

    await expect(dense.embedMany(['1', '2'])).resolves.toEqual([[1], [2]])
    expect(attempts).toBe(2)
  })

    it('applies rate limits across concurrent calls on the same embedding', async () => {
    let active = 0
    let maxActive = 0
    const dense = makeEmbedding({
      kind: 'dense',
      name: 'limited-dense',
      dimensions: 1,
      maxInputTokens: 100,
      batch: { maxSize: 1, concurrency: 4 },
      rateLimit: { concurrency: 1 },
      embed: async (texts) => {
        active++
        maxActive = Math.max(maxActive, active)
        await new Promise((resolve) => setTimeout(resolve, 5))
        active--
        return texts.map((text) => [Number(text)])
      },
    })

    await Promise.all([dense.embedMany(['1', '2']), dense.embedMany(['3', '4'])])
    expect(maxActive).toBe(1)
  })
})
