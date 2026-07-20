import { describe, expect, it, vi } from 'vitest'
import { embedding, type DenseEmbedding } from '../../src/embedding'
import { indexer } from '../../src/indexing'
import { inMemoryRecordStore, inMemoryVectorStore } from '../../src/storage'

describe('indexer embedding-stage validation', () => {
  it('recomputes and replaces malformed dense cache entries', async () => {
    const embed = vi.fn(async (texts: string[]) => texts.map((text) => [text.length, 1]))
    const storedRecords = inMemoryRecordStore()
    let injected: { key: string; value: Awaited<ReturnType<typeof storedRecords.get>> } | undefined
    const records = {
      ...storedRecords,
      get: async (key: string) => (key === injected?.key ? injected.value : storedRecords.get(key)),
    }
    const docs = indexer({
      id: 'docs',
      namespace: 'kb',
      records,
      vectors: inMemoryVectorStore(),
      dense: embedding({
        kind: 'dense',
        name: 'dense-test',
        dimensions: 2,
        maxInputTokens: 100,
        batch: { maxSize: 8 },
        version: 'v1',
        embed,
      }),
      cache: true,
    })
    const input = [{ namespace: 'kb', sourceId: 'source-a', content: 'hello' }]

    await docs.indexDocuments(input)
    const [entry] = (await records.list('indexer:docs:namespace:kb:embedding-cache:')).entries

    if (!entry) throw new Error('Expected the first indexing run to cache an embedding bundle.')
    for (const vectors of [[[5]], [[Number.NaN, 1]], []]) {
      injected = { key: entry.key, value: { ...entry.value, vectors } }
      const result = await docs.indexDocuments(input)
      injected = undefined

      expect(result.stages?.find((stage) => stage.kind === 'embedding')?.cache).toBe('miss')
      await expect(records.get(entry.key)).resolves.toMatchObject({ vectors: [[5, 1]] })
    }

    await docs.indexDocuments(input)
    expect(embed).toHaveBeenCalledTimes(4)
  })

  it('does not publish cache or generation writes when the provider fails', async () => {
    let shouldFail = false
    const records = inMemoryRecordStore()
    const docs = indexer({
      id: 'docs',
      namespace: 'kb',
      records,
      vectors: inMemoryVectorStore(),
      dense: embedding({
        kind: 'dense',
        name: 'dense-test',
        dimensions: 2,
        maxInputTokens: 100,
        batch: { maxSize: 8 },
        version: 'v1',
        embed: async (texts) => {
          if (shouldFail) throw new Error('provider unavailable')
          return texts.map((text) => [text.length, 1])
        },
      }),
      cache: true,
    })

    await docs.indexDocuments([{ namespace: 'kb', sourceId: 'source-a', content: 'stable' }])
    const sourcePrefix = 'indexer:docs:namespace:kb:source:source-a:'
    const cachePrefix = 'indexer:docs:namespace:kb:embedding-cache:'
    const sourceBefore = await records.list(sourcePrefix)
    const cacheBefore = await records.list(cachePrefix)
    shouldFail = true

    await expect(
      docs.indexDocuments([{ namespace: 'kb', sourceId: 'source-a', content: 'changed' }]),
    ).rejects.toThrow('provider unavailable')

    await expect(records.list(sourcePrefix)).resolves.toEqual(sourceBefore)
    await expect(records.list(cachePrefix)).resolves.toEqual(cacheBefore)
  })

  it('does not publish cache or generation writes for incomplete provider output', async () => {
    let returnIncompleteOutput = false
    const records = inMemoryRecordStore()
    const docs = indexer({
      id: 'docs',
      namespace: 'kb',
      records,
      vectors: inMemoryVectorStore(),
      dense: embedding({
        kind: 'dense',
        name: 'dense-test',
        dimensions: 2,
        maxInputTokens: 100,
        batch: { maxSize: 8 },
        version: 'v1',
        embed: async (texts) =>
          returnIncompleteOutput ? [] : texts.map((text) => [text.length, 1]),
      }),
      cache: true,
    })

    await docs.indexDocuments([{ namespace: 'kb', sourceId: 'source-a', content: 'stable' }])
    const sourcePrefix = 'indexer:docs:namespace:kb:source:source-a:'
    const cachePrefix = 'indexer:docs:namespace:kb:embedding-cache:'
    const sourceBefore = await records.list(sourcePrefix)
    const cacheBefore = await records.list(cachePrefix)
    returnIncompleteOutput = true

    await expect(
      docs.indexDocuments([{ namespace: 'kb', sourceId: 'source-a', content: 'changed' }]),
    ).rejects.toThrow(/embedding/i)

    await expect(records.list(sourcePrefix)).resolves.toEqual(sourceBefore)
    await expect(records.list(cachePrefix)).resolves.toEqual(cacheBefore)
  })

  it('never caches a structural embedding whose vector semantics have no fingerprint', async () => {
    const embedMany = vi.fn(async (texts: string[]) => texts.map((text) => [text.length, 1]))
    const dense: DenseEmbedding = {
      _tag: 'Embedding',
      kind: 'dense',
      name: 'structural-dense',
      dimensions: 2,
      maxInputTokens: 100,
      batch: { maxSize: 8, concurrency: 1 },
      embed: async (text) => [text.length, 1],
      embedMany,
      asEmbedFn: () => async (text) => [text.length, 1],
    }
    const records = inMemoryRecordStore()
    const docs = indexer({
      id: 'docs',
      namespace: 'kb',
      records,
      vectors: inMemoryVectorStore(),
      dense,
      cache: true,
    })
    const input = [{ namespace: 'kb', sourceId: 'source-a', content: 'hello' }]

    const first = await docs.indexDocuments(input)
    const second = await docs.indexDocuments(input)

    expect(embedMany).toHaveBeenCalledTimes(2)
    await expect(records.list('indexer:docs:namespace:kb:embedding-cache:')).resolves.toMatchObject({
      entries: [],
    })
    expect(first.stages?.find((stage) => stage.kind === 'embedding')?.cache).toBeUndefined()
    expect(second.stages?.find((stage) => stage.kind === 'embedding')?.cache).toBeUndefined()
  })
})
