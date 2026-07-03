import { describe, expect, it } from 'vitest'
import { embedding } from '../../embedding'
import { corpus as createCorpus, indexer as createIndexer } from '../../indexing'
import { knowledgeBase } from '../../retrieval'
import { inMemoryRecordStore, inMemoryStorage, inMemoryVectorStore } from '../../storage'

function createTopicEmbedding() {
  return embedding({
    kind: 'dense',
    name: 'topic-dense',
    dimensions: 2,
    maxInputTokens: 100,
    batch: { maxSize: 8 },
    embed: async (texts) =>
      texts.map((text) => (text.toLowerCase().includes('pricing') ? [1, 0] : [0, 1])),
  })
}

describe('knowledgeBase', () => {
  it('indexes documents into a store-backed retriever and exposes lifecycle metadata', async () => {
    const docs = knowledgeBase({
      id: 'docs',
      storage: inMemoryStorage(),
      embeddings: createTopicEmbedding(),
    })

    await expect(
      docs.index([
        {
          namespace: 'docs',
          sourceId: 'pricing',
          content: 'Pricing guide',
          metadata: { topic: 'pricing' },
        },
        {
          namespace: 'docs',
          sourceId: 'support',
          content: 'Support handbook',
          metadata: { topic: 'support' },
        },
      ]),
    ).resolves.toMatchObject({
      namespace: 'docs',
      sourceCount: 2,
      chunkCount: 2,
    })

    await expect(docs.retriever().retrieve('pricing', { limit: 1 })).resolves.toEqual([
      expect.objectContaining({
        namespace: 'docs',
        sourceId: 'pricing',
        content: 'Pricing guide',
        metadata: { topic: 'pricing' },
      }),
    ])

    expect(docs.inspect()).toMatchObject({
      id: 'docs',
      namespace: 'docs',
      lifecycle: {
        status: 'ready',
        retention: 'cleanup',
        indexedSources: 2,
        indexedChunks: 2,
      },
      source: { kind: 'direct' },
      storage: { records: true, vectors: true },
      capabilities: {
        dense: true,
        sparse: false,
        hybrid: false,
        delete: true,
      },
    })
  })

  it('reindexes a source without returning stale hits', async () => {
    const docs = knowledgeBase({
      id: 'docs',
      storage: inMemoryStorage(),
      embeddings: createTopicEmbedding(),
    })

    await docs.index([
      {
        namespace: 'docs',
        sourceId: 'pricing',
        content: 'Old pricing guide',
      },
    ])

    await docs.reindex([
      {
        namespace: 'docs',
        sourceId: 'pricing',
        content: 'New pricing guide',
      },
    ])

    const hits = await docs.retriever().retrieve('pricing', { limit: 5 })

    expect(hits.map((hit) => hit.content)).toEqual(['New pricing guide'])
    expect(docs.inspect().lifecycle).toMatchObject({
      indexedSources: 1,
      indexedChunks: 1,
      retainedInactiveChunks: 0,
    })
  })

  it('can retain inactive generations while keeping retrieval active-only', async () => {
    const docs = knowledgeBase({
      id: 'docs',
      storage: inMemoryStorage(),
      embeddings: createTopicEmbedding(),
      lifecycle: { retention: 'retain-inactive' },
    })

    await docs.index([
      {
        namespace: 'docs',
        sourceId: 'pricing',
        content: 'Old pricing guide',
      },
    ])
    await docs.reindex([
      {
        namespace: 'docs',
        sourceId: 'pricing',
        content: 'New pricing guide',
      },
    ])

    await expect(docs.retriever().retrieve('pricing', { threshold: 0.5 })).resolves.toEqual([
      expect.objectContaining({ content: 'New pricing guide' }),
    ])
    expect(docs.inspect().lifecycle).toMatchObject({
      retention: 'retain-inactive',
      indexedSources: 1,
      indexedChunks: 1,
      retainedInactiveChunks: 1,
    })
  })

  it('constructs grounding as a later-phase stub without requiring stores', () => {
    const docs = knowledgeBase({ id: 'docs' })

    expect(docs.grounding()).toMatchObject({
      _tag: 'Grounding',
      id: 'grounding:docs',
    })
  })

  it('removes a source from retrieval immediately', async () => {
    const docs = knowledgeBase({
      id: 'docs',
      storage: inMemoryStorage(),
      embeddings: createTopicEmbedding(),
    })

    await docs.index([
      {
        namespace: 'docs',
        sourceId: 'pricing',
        content: 'Pricing guide',
      },
      {
        namespace: 'docs',
        sourceId: 'support',
        content: 'Support handbook',
      },
    ])

    await expect(docs.remove('pricing')).resolves.toMatchObject({
      sourceId: 'pricing',
      deletedCount: 1,
    })

    await expect(docs.retriever().retrieve('pricing', { limit: 5, threshold: 0.5 })).resolves.toEqual([])
    await expect(docs.retriever().retrieve('support', { limit: 5, threshold: 0.5 })).resolves.toEqual([
      expect.objectContaining({ sourceId: 'support', content: 'Support handbook' }),
    ])
    expect(docs.inspect().lifecycle).toMatchObject({
      indexedSources: 1,
      indexedChunks: 1,
    })
  })

  it('isolates scoped handles by namespace', async () => {
    const storage = inMemoryStorage()
    const root = knowledgeBase({
      id: 'docs',
      storage,
      embeddings: createTopicEmbedding(),
    })
    const tenantA = root.scope({ namespace: 'tenant-a' })
    const tenantB = root.scope({ namespace: 'tenant-b' })

    expect('scope' in tenantA).toBe(false)

    await tenantA.index([
      {
        namespace: 'tenant-a',
        sourceId: 'guide',
        content: 'Pricing for tenant A',
      },
    ])
    await tenantB.index([
      {
        namespace: 'tenant-b',
        sourceId: 'guide',
        content: 'Pricing for tenant B',
      },
    ])

    await expect(tenantA.retriever().retrieve('pricing', { threshold: 0.5 })).resolves.toEqual([
      expect.objectContaining({
        namespace: 'tenant-a',
        content: 'Pricing for tenant A',
      }),
    ])
    await expect(tenantB.retriever().retrieve('pricing', { threshold: 0.5 })).resolves.toEqual([
      expect.objectContaining({
        namespace: 'tenant-b',
        content: 'Pricing for tenant B',
      }),
    ])
  })

  it('indexes through a configured corpus and keeps retrieval store-backed', async () => {
    const records = inMemoryRecordStore()
    const vectors = inMemoryVectorStore()
    const embeddings = createTopicEmbedding()
    const index = createIndexer({
      id: 'docs',
      namespace: 'docs',
      records,
      vectors,
      dense: embeddings,
    })
    const corpus = createCorpus({
      id: 'docs',
      namespace: 'docs',
      records,
      indexer: index,
    })
    const docs = knowledgeBase({
      id: 'docs',
      corpus,
      records,
      vectors,
      embeddings,
    })

    await expect(
      docs.index([
        {
          namespace: 'docs',
          sourceId: 'pricing',
          content: 'Pricing guide',
        },
      ]),
    ).resolves.toMatchObject({
      corpusId: 'docs',
      added: 1,
      chunkCount: 1,
    })

    await expect(docs.retriever().retrieve('pricing', { threshold: 0.5 })).resolves.toEqual([
      expect.objectContaining({ sourceId: 'pricing', content: 'Pricing guide' }),
    ])
    await expect(corpus.getSource('pricing')).resolves.toMatchObject({
      sourceId: 'pricing',
      status: 'indexed',
    })
    expect(docs.inspect()).toMatchObject({
      source: { kind: 'corpus' },
      lifecycle: { indexedSources: 1, indexedChunks: 1 },
    })
  })
})
