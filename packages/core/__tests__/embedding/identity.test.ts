import { describe, expect, it, vi } from 'vitest'
import {
  embedding,
  embeddingCache,
  embeddingIdentity,
  normalizeText,
  type DenseEmbedding,
  type EmbeddingCache,
  type EmbeddingPreprocessor,
} from '../../src/embedding'
import { inMemoryRecordStore } from '../../src/storage'

interface DenseOverrides {
  name?: string
  dimensions?: number
  maxInputTokens?: number
  batch?: { maxSize: number; concurrency?: number }
  preprocess?: EmbeddingPreprocessor
  truncate?: { strategy: 'chars'; maxChars: number }
  retry?: { maxAttempts: number; baseDelayMs?: number }
  cache?: EmbeddingCache
  rateLimit?: { concurrency: number }
  version?: string
  modalities?: readonly ('text' | 'image')[]
  normalization?: 'unit' | 'none' | 'unknown'
  tasks?: { query?: string; document?: string }
}

function denseEmbedding(overrides: DenseOverrides = {}) {
  return embedding({
    kind: 'dense',
    name: 'dense-test',
    dimensions: 2,
    maxInputTokens: 100,
    batch: { maxSize: 8 },
    embed: async (inputs) => inputs.map(() => [1, 2]),
    ...overrides,
  })
}

describe('embedding identity', () => {
  it('fingerprints vector semantics while excluding operational policy', () => {
    const base = denseEmbedding()
    const records = inMemoryRecordStore()

    expect(base.fingerprint).toEqual(expect.any(String))
    expect(base.fingerprint).toEqual(denseEmbedding().fingerprint)
    expect(denseEmbedding({ name: 'other-name' }).fingerprint).not.toBe(base.fingerprint)
    expect(denseEmbedding({ dimensions: 3 }).fingerprint).not.toBe(base.fingerprint)
    expect(denseEmbedding({ maxInputTokens: 200 }).fingerprint).not.toBe(base.fingerprint)
    expect(
      denseEmbedding({ preprocess: normalizeText({ lowercase: true }) }).fingerprint,
    ).not.toBe(base.fingerprint)
    expect(denseEmbedding({ truncate: { strategy: 'chars', maxChars: 20 } }).fingerprint).not.toBe(
      base.fingerprint,
    )
    expect(denseEmbedding({ version: 'model-v2' }).fingerprint).not.toBe(base.fingerprint)
    expect(denseEmbedding({ modalities: ['text', 'image'] }).fingerprint).not.toBe(base.fingerprint)
    expect(denseEmbedding({ normalization: 'unit' }).fingerprint).not.toBe(base.fingerprint)
    expect(denseEmbedding({ tasks: { query: 'QUERY', document: 'DOCUMENT' } }).fingerprint).not.toBe(
      base.fingerprint,
    )

    expect(denseEmbedding({ batch: { maxSize: 2, concurrency: 2 } }).fingerprint).toBe(base.fingerprint)
    expect(denseEmbedding({ retry: { maxAttempts: 3, baseDelayMs: 1 } }).fingerprint).toBe(base.fingerprint)
    expect(denseEmbedding({ rateLimit: { concurrency: 2 } }).fingerprint).toBe(base.fingerprint)
    expect(
      denseEmbedding({
        cache: embeddingCache({ records, namespace: 'identity-a' }),
      }).fingerprint,
    ).toBe(base.fingerprint)
    expect(
      denseEmbedding({
        cache: embeddingCache({ records, namespace: 'identity-b' }),
      }).fingerprint,
    ).toBe(base.fingerprint)
  })

  it('exposes fingerprints on sparse embeddings', () => {
    const sparse = embedding({
      kind: 'sparse',
      name: 'sparse-test',
      maxInputTokens: 100,
      batch: { maxSize: 8 },
      version: 'model-v1',
      embed: async (texts) => texts.map(() => ({ indices: [0], values: [1] })),
    })

    expect(sparse.fingerprint).toEqual(expect.any(String))
    expect(sparse.modalities).toEqual(['text'])
  })

  it('exposes the resolved dense space with the governance fingerprint', () => {
    const dense = denseEmbedding({
      version: 'model-v1',
      modalities: ['image', 'text'],
      normalization: 'unit',
      tasks: { query: 'QUERY', document: 'DOCUMENT' },
    })

    expect(dense.space).toEqual({
      name: 'dense-test',
      version: 'model-v1',
      dimensions: 2,
      modalities: ['image', 'text'],
      normalization: 'unit',
      tasks: { query: 'QUERY', document: 'DOCUMENT' },
      fingerprint: dense.fingerprint,
    })
    expect(dense.space.fingerprint).toBe(dense.fingerprint)
  })

  it('keeps per-text cache entries separate across declared versions', async () => {
    const records = inMemoryRecordStore()
    const cache = embeddingCache({ records, namespace: 'versioned' })
    const embedV1 = vi.fn(async () => [[1]])
    const embedV2 = vi.fn(async () => [[2]])
    const versionOne = embedding({
      kind: 'dense',
      name: 'same-name',
      dimensions: 1,
      maxInputTokens: 100,
      batch: { maxSize: 8 },
      cache,
      version: 'v1',
      embed: embedV1,
    })
    const versionTwo = embedding({
      kind: 'dense',
      name: 'same-name',
      dimensions: 1,
      maxInputTokens: 100,
      batch: { maxSize: 8 },
      cache,
      version: 'v2',
      embed: embedV2,
    })

    await expect(versionOne.embed('hello')).resolves.toEqual([1])
    await expect(versionTwo.embed('hello')).resolves.toEqual([2])
    expect(embedV1).toHaveBeenCalledOnce()
    expect(embedV2).toHaveBeenCalledOnce()
  })

  it('resolves explicit fingerprints before structural fallbacks', () => {
    const structural = {
      _tag: 'Embedding',
      kind: 'dense',
      name: 'structural',
      dimensions: 2,
      maxInputTokens: 100,
      batch: { maxSize: 8, concurrency: 1 },
      embed: async () => [1, 2],
      embedMany: async (texts: string[]) => texts.map(() => [1, 2]),
      asEmbedFn: () => async () => [1, 2],
    } satisfies DenseEmbedding

    expect(embeddingIdentity(structural)).toBe(
      embeddingIdentity({ ...structural }),
    )
    expect(embeddingIdentity({ ...structural, dimensions: 3 })).not.toBe(
      embeddingIdentity(structural),
    )
    expect(embeddingIdentity({ ...structural, fingerprint: 'declared:v1' })).toBe('declared:v1')
  })
})
