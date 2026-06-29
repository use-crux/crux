import { describe, expect, it } from 'vitest'
import { createIndexedKnowledgeStore } from '../../indexed-knowledge'
import { inMemoryDataStore, inMemoryVectorStore } from '../../storage'
import { inMemoryCruxStore } from '../../store/memory'

describe('indexed knowledge store', () => {
  it('persists generations, searches active chunks, and expands parents through the read model', async () => {
    const data = inMemoryDataStore()
    const vectors = inMemoryVectorStore()
    const records = createIndexedKnowledgeStore({
      indexerId: 'docs',
      namespace: 'kb',
      data,
      vectors,
    })

    await records.persistGeneration({
      chunks: [
        {
          namespace: 'kb',
          sourceId: 'pricing',
          chunkId: 'a',
          ordinal: 0,
          content: 'old pricing',
          metadata: { topic: 'pricing' },
          parent: { parentId: 'parent-1', title: 'Pricing Guide' },
        },
      ],
      parents: [
        {
          namespace: 'kb',
          sourceId: 'pricing',
          parentId: 'parent-1',
          ordinal: 0,
          content: 'old pricing parent',
          metadata: { section: 'pricing' },
        },
      ],
      dense: [[0.5, 0.5]],
      replaceSources: true,
    })

    await records.persistGeneration({
      chunks: [
        {
          namespace: 'kb',
          sourceId: 'pricing',
          chunkId: 'b',
          ordinal: 0,
          content: 'new pricing',
          metadata: { topic: 'pricing' },
          parent: { parentId: 'parent-2', title: 'Pricing Guide' },
        },
      ],
      parents: [
        {
          namespace: 'kb',
          sourceId: 'pricing',
          parentId: 'parent-2',
          ordinal: 0,
          content: 'new pricing parent',
          metadata: { section: 'pricing' },
        },
      ],
      dense: [[1, 0]],
      replaceSources: true,
    })

    const hits = await records.searchChunks({
      mode: 'dense',
      dense: [1, 0],
      filter: { topic: 'pricing' },
    })

    expect(hits.map((hit) => hit.content)).toEqual(['new pricing'])
    await expect(records.expandParent(hits[0])).resolves.toMatchObject({
      content: 'new pricing',
      parent: {
        parentId: 'parent-2',
        title: 'Pricing Guide',
        content: 'new pricing parent',
        metadata: { section: 'pricing' },
      },
    })
  })

  it('deletes source and namespace records from data and vector stores consistently', async () => {
    const data = inMemoryDataStore()
    const vectors = inMemoryVectorStore()
    const records = createIndexedKnowledgeStore({
      indexerId: 'docs',
      namespace: 'kb',
      data,
      vectors,
    })

    await records.persistGeneration({
      chunks: [
        {
          namespace: 'kb',
          sourceId: 'pricing',
          chunkId: 'a',
          ordinal: 0,
          content: 'pricing',
          metadata: {},
        },
        {
          namespace: 'kb',
          sourceId: 'setup',
          chunkId: 'a',
          ordinal: 0,
          content: 'setup',
          metadata: {},
        },
      ],
      parents: [],
      dense: [
        [1, 0],
        [0, 1],
      ],
      replaceSources: true,
    })

    await expect(records.deleteSource('pricing')).resolves.toBe(1)
    await expect(records.searchChunks({ mode: 'dense', dense: [1, 0], threshold: 0.5 })).resolves.toEqual([])
    await expect(records.searchChunks({ mode: 'dense', dense: [0, 1], threshold: 0.5 })).resolves.toHaveLength(1)

    await expect(records.clearNamespace()).resolves.toBe(1)
    await expect(records.searchChunks({ mode: 'dense', dense: [0, 1], threshold: 0.5 })).resolves.toEqual([])
  })

  it('expands parents from derived refs and supports missing-parent errors', async () => {
    const data = inMemoryDataStore()
    const records = createIndexedKnowledgeStore({
      indexerId: 'docs',
      namespace: 'kb',
      data,
    })

    await records.persistGeneration({
      chunks: [],
      parents: [
        {
          namespace: 'kb',
          sourceId: 'guide',
          parentId: 'parent-a',
          ordinal: 0,
          content: 'parent body',
          metadata: { title: 'Guide' },
        },
      ],
      replaceSources: true,
    })

    await expect(
      records.expandParent({
        namespace: 'kb',
        sourceId: 'guide',
        chunkId: 'child-a',
        content: 'child body',
        metadata: {},
        score: 1,
        parent: { parentId: 'parent-a' },
      }),
    ).resolves.toMatchObject({
      parent: {
        parentId: 'parent-a',
        content: 'parent body',
        metadata: { title: 'Guide' },
      },
    })

    await expect(
      records.expandParent(
        {
          namespace: 'kb',
          sourceId: 'guide',
          chunkId: 'child-b',
          content: 'child body',
          metadata: {},
          score: 1,
          parent: { parentId: 'missing' },
        },
        { missing: 'error' },
      ),
    ).rejects.toThrow('parentExpand could not find parent record')
  })

  it('supports legacy combined store vector search while mapping chunk hits', async () => {
    const store = inMemoryCruxStore()
    const records = createIndexedKnowledgeStore({
      indexerId: 'docs',
      namespace: 'kb',
      data: store,
      legacyStore: store,
    })

    await records.persistGeneration({
      chunks: [
        {
          namespace: 'kb',
          sourceId: 'legacy',
          chunkId: 'a',
          ordinal: 0,
          content: 'legacy chunk',
          metadata: { topic: 'legacy' },
        },
      ],
      parents: [],
      dense: [[1, 0]],
      replaceSources: true,
    })

    await expect(
      records.searchChunks({
        mode: 'dense',
        dense: [1, 0],
        filter: { namespace: 'kb' },
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        sourceId: 'legacy',
        chunkId: 'a',
        content: 'legacy chunk',
      }),
    ])
  })
})
