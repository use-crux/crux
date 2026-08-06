import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { embedding as makeEmbedding } from '../../src/embedding'
import { indexer as makeIndexer } from '../../src/indexing'
import { retriever as makeRetriever } from '../../src/retrieval'
import { inMemoryRecordStore, inMemorySearchStore } from '../../src/storage'
import type { JsonObject, SearchHit } from '../../src/storage'
import { textOf } from '../embedding/text-input'

function createDenseEmbedding() {
  return makeEmbedding({
    kind: 'dense',
    name: 'test-dense',
    dimensions: 2,
    maxInputTokens: 100,
    batch: { maxSize: 8 },
    embed: async (inputs) => inputs.map((input) => [textOf(input).length, textOf(input).length / 2]),
  })
}

function createSparseEmbedding() {
  return makeEmbedding({
    kind: 'sparse',
    name: 'test-sparse',
    maxInputTokens: 100,
    batch: { maxSize: 8 },
    embed: async (texts) =>
      texts.map((text) => ({
        indices: text.split('').map((_, index) => index),
        values: text.split('').map(() => 1),
      })),
  })
}

function createSearchHit(
  key: string,
  value: {
    namespace: string
    sourceId: string
    chunkId: string
    content: string
    metadata?: JsonObject
    parent?: JsonObject
  },
  score: number,
): { readonly record: JsonObject; readonly hit: SearchHit } {
  return {
    record: {
      _cruxRecordType: 'chunk',
      namespace: value.namespace,
      sourceId: value.sourceId,
      chunkId: value.chunkId,
      content: value.content,
      metadata: value.metadata ?? {},
      generationId: 'gen-test',
      active: true,
      ordinal: 0,
      createdAt: 1,
      updatedAt: 1,
      ...(value.parent ? { parent: value.parent } : {}),
    },
    hit: { key, score, matches: [{ kind: 'dense', rank: 1, score }] },
  }
}

describe('retriever', () => {
    it('retrieves chunks indexed into explicit record and search stores', async () => {
    const records = inMemoryRecordStore()
    const search = inMemorySearchStore()
    const dense = createDenseEmbedding()
    const indexer = makeIndexer({
      id: 'docs',
      namespace: 'docs',
      records,
      search,
      dense,
    })

    await indexer.indexDocuments([
      {
        namespace: 'docs',
        sourceId: 'guide.md',
        content: 'Alpha',
      },
    ])

    const retriever = makeRetriever({
      id: 'docs',
      namespace: 'docs',
      records,
      search,
      dense,
    })

    const hits = await retriever.retrieve('Alpha')

    expect(hits).toEqual([
      expect.objectContaining({
        source: { id: 'guide.md' },
        content: 'Alpha',
      }),
    ])
  })

    it('retrieves dense hits via search.search and forwards user filters', async () => {
    const dense = createDenseEmbedding()
    const records = inMemoryRecordStore()
    const search = inMemorySearchStore()
    const key = 'retriever:r1:source:doc-1:chunk:0'
    const chunk = createSearchHit(
      key,
      {
        namespace: 'docs',
        sourceId: 'doc-1',
        chunkId: '0',
        content: 'Launch checklist',
        metadata: { topic: 'launch' },
        parent: { title: 'Launch Plan' },
      },
      0.92,
    )
    await records.put(key, chunk.record)
    const searchSpy = vi.spyOn(search, 'search').mockResolvedValue([chunk.hit])

    const retriever = makeRetriever({
      id: 'r1',
      namespace: 'docs',
      records,
      search,
      dense,
      limit: 2,
      filter: { topic: 'launch' },
    })

    const hits = await retriever.retrieve('launch steps', { limit: 3, threshold: 0.4 })

    expect(searchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        legs: [{ kind: 'dense', vector: [12, 6] }],
        limit: 3,
        threshold: 0.4,
        filter: expect.objectContaining({ topic: 'launch', namespace: 'docs' }),
      }),
    )
    expect(hits).toEqual([
      {
        namespace: 'docs',
        source: { id: 'doc-1' },
        chunkId: '0',
        content: 'Launch checklist',
        metadata: { topic: 'launch' },
        score: 0.92,
        parent: { title: 'Launch Plan' },
        provenance: {
          matches: [{ kind: 'dense', rank: 1, score: 0.92 }],
        },
      },
    ])
  })

    it('uses SearchStore for dense retrieval', async () => {
    const dense = createDenseEmbedding()
    const records = inMemoryRecordStore()
    const search = inMemorySearchStore()
    const key = 'retriever:r1:source:doc-2:chunk:1'
    const chunk = createSearchHit(
      key,
      {
        namespace: 'docs',
        sourceId: 'doc-2',
        chunkId: '1',
        content: 'Roadmap notes',
        metadata: {},
      },
      0.88,
    )
    await records.put(key, chunk.record)
    const searchSpy = vi.spyOn(search, 'search').mockResolvedValue([chunk.hit])

    const retriever = makeRetriever({
      id: 'r1',
      namespace: 'docs',
      records,
      search,
      dense,
    })

    const hits = await retriever.retrieve('roadmap query', { limit: 4 })

    expect(searchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        legs: [{ kind: 'dense', vector: [13, 6.5] }],
        limit: 4,
        filter: expect.objectContaining({ namespace: 'docs' }),
      }),
    )
    expect(hits[0].source.id).toBe('doc-2')
  })

    it('asContext renders retrieved hits from a static query', async () => {
    const retriever = makeRetriever({
      id: 'r1',
      namespace: 'docs',
      retrieve: async () => [
        {
          namespace: 'docs',
          source: { id: 'doc-1' },
          chunkId: '0',
          content: 'Release notes',
          metadata: {},
          score: 0.93,
        },
      ],
      context: {
        query: 'release notes',
      },
    })

    const system = await retriever.asContext().systemFn({})

    expect(system).toContain('## Retrieved Context (release notes)')
    expect(system).toContain('[doc-1/0]')
    expect(system).toContain('Release notes')
  })

    it('injects context by default when context query is configured', async () => {
    const { prompt } = await import('../../src/prompt/prompt')
    const retriever = makeRetriever({
      id: 'docs',
      namespace: 'docs',
      retrieve: async () => [
        {
          namespace: 'docs',
          source: { id: 'doc-1' },
          chunkId: '0',
          content: 'Release notes',
          metadata: {},
          score: 0.93,
        },
      ],
      context: {
        query: ({ question }: any) => question,
      },
    })
    const answer = prompt({
      use: [retriever],
      input: z.object({ question: z.string() }),
      system: 'Base.',
    })

    const resolved = await answer.resolve({ input: { question: 'release' } })

    expect(resolved.system).toContain('Release notes')
    expect(resolved.tools).toBeUndefined()
  })

    it('asContext supports a dynamic query function', async () => {
    const retrieve = vi.fn(async (query: string) => [
      {
        namespace: 'docs',
        source: { id: 'doc-3' },
        chunkId: '2',
        content: `Result for ${query}`,
        metadata: {},
        score: 0.8,
      },
    ])
    const retriever = makeRetriever({
      id: 'r1',
      namespace: 'docs',
      retrieve,
    })

    const ctx = retriever.asContext({
      query: (input) => String(input.topic),
      priority: 77,
    })

    const system = await ctx.systemFn({ topic: 'pricing' })

    expect(ctx.priority).toBe(77)
    expect(retrieve).toHaveBeenCalledWith('pricing', { limit: 5 })
    expect(system).toContain('Result for pricing')
  })

    it('throws when asContext has no query source', async () => {
    const retriever = makeRetriever({
      id: 'r1',
      namespace: 'docs',
      retrieve: async () => [],
    })

    await expect(retriever.asContext().systemFn({})).rejects.toThrow('requires a query')
  })

  it('supports a fully custom retriever', async () => {
    const retriever = makeRetriever({
      id: 'r1',
      namespace: 'docs',
      retrieve: async (query) => [
        {
          namespace: 'docs',
          source: { id: 'custom-source' },
          chunkId: 'custom-chunk',
          content: `custom:${query}`,
          metadata: { provider: 'custom' },
          score: 1,
        },
      ],
    })

    expect(retriever.mode).toBe('custom')
    const hits = await retriever.retrieve('alpha')

    expect(hits[0].content).toBe('custom:alpha')
  })

  it('omits invalid custom source narrowing instead of guessing', async () => {
    const retriever = makeRetriever({
      id: 'custom',
      namespace: 'docs',
      retrieve: async () => [{
        namespace: 'docs', source: { id: 'audio', location: { type: 'time', unit: 'seconds', start: 3, end: 2 } } as never,
        chunkId: 'a', content: 'audio', metadata: {}, score: 1,
      }],
    })

    await expect(retriever.retrieve('audio')).resolves.toMatchObject([{ source: { id: 'audio' } }])
  })

    it('retrieves sparse hits through SearchStore', async () => {
    const sparse = createSparseEmbedding()
    const records = inMemoryRecordStore()
    const search = inMemorySearchStore()
    const key = 'retriever:r1:source:doc-5:chunk:0'
    const chunk = createSearchHit(
      key,
      {
        namespace: 'docs',
        sourceId: 'doc-5',
        chunkId: '0',
        content: 'Sparse hit',
        metadata: { leg: 'sparse' },
      },
      0.77,
    )
    await records.put(key, chunk.record)
    const searchSpy = vi.spyOn(search, 'search').mockResolvedValue([chunk.hit])

    const retriever = makeRetriever({
      id: 'r1',
      namespace: 'docs',
      records,
      search,
      sparse,
      plan: { sparse: true },
    })

    const hits = await retriever.retrieve('sparse', {})

    expect(retriever.mode).toBe('search')
    expect(searchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        legs: [{ kind: 'sparse', vector: { indices: [0, 1, 2, 3, 4, 5], values: [1, 1, 1, 1, 1, 1] } }],
        filter: expect.objectContaining({ namespace: 'docs' }),
      }),
    )
    expect(hits[0].metadata).toEqual({ leg: 'sparse' })
  })

    it('retrieves hybrid hits through SearchStore with fusion', async () => {
    const dense = createDenseEmbedding()
    const sparse = createSparseEmbedding()
    const records = inMemoryRecordStore()
    const search = inMemorySearchStore()
    const key = 'retriever:r1:source:doc-6:chunk:1'
    const chunk = createSearchHit(
      key,
      {
        namespace: 'docs',
        sourceId: 'doc-6',
        chunkId: '1',
        content: 'Hybrid hit',
        metadata: { plan: 'dense-sparse' },
      },
      0.91,
    )
    await records.put(key, chunk.record)
    const searchSpy = vi.spyOn(search, 'search').mockResolvedValue([chunk.hit])

    const retriever = makeRetriever({
      id: 'r1',
      namespace: 'docs',
      records,
      search,
      dense,
      sparse,
      plan: { dense: true, sparse: true, fusion: { strategy: 'rrf' } },
    })

    const hits = await retriever.retrieve('hybrid')

    expect(retriever.mode).toBe('search')
    expect(searchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        legs: [
          { kind: 'dense', vector: [6, 3] },
          { kind: 'sparse', vector: { indices: [0, 1, 2, 3, 4, 5], values: [1, 1, 1, 1, 1, 1] } },
        ],
        fusion: { strategy: 'rrf' },
      }),
    )
    expect(hits[0].content).toBe('Hybrid hit')
  })

    it('retrieves chunks that were indexed through indexer', async () => {
    const records = inMemoryRecordStore()
    const search = inMemorySearchStore()
    const dense = makeEmbedding({
      kind: 'dense',
      name: 'integration-dense',
      dimensions: 2,
      maxInputTokens: 100,
      batch: { maxSize: 8 },
      embed: async (inputs) =>
        inputs.map((input) => {
          const normalized = textOf(input).toLowerCase()
          return normalized.includes('pricing') ? [1, 0] : [0, 1]
        }),
    })
    const indexer = makeIndexer({
      id: 'docs',
      namespace: 'docs',
      records,
      search,
      dense,
    })

    await indexer.indexDocuments([
      {
        namespace: 'docs',
        sourceId: 'pricing-doc',
        title: 'Pricing',
        content: 'Pricing plan details',
      },
      {
        namespace: 'docs',
        sourceId: 'support-doc',
        title: 'Support',
        content: 'Support guide',
      },
    ])

    const retriever = makeRetriever({
      id: 'r1',
      namespace: 'docs',
      records,
      search,
      dense,
      limit: 1,
    })

    const hits = await retriever.retrieve('pricing')

    expect(hits).toHaveLength(1)
    expect(hits[0].source.id).toBe('pricing-doc')
    expect(hits[0].parent).toEqual({ title: 'Pricing' })
  })

    it('excludes inactive generations from indexed retrieval', async () => {
    const records = inMemoryRecordStore()
    const search = inMemorySearchStore()
    const dense = makeEmbedding({
      kind: 'dense',
      name: 'integration-dense',
      dimensions: 2,
      maxInputTokens: 100,
      batch: { maxSize: 8 },
      embed: async (inputs) =>
        inputs.map((input) => (textOf(input).includes('pricing') ? [1, 0] : [0, 1])),
    })
    const indexer = makeIndexer({
      id: 'docs',
      namespace: 'docs',
      records,
      search,
      dense,
    })

    await indexer.indexDocuments([{ namespace: 'docs', sourceId: 'pricing-doc', content: 'old pricing details' }])
    await indexer.indexDocuments([{ namespace: 'docs', sourceId: 'pricing-doc', content: 'new pricing details' }])

    const retriever = makeRetriever({
      id: 'r1',
      namespace: 'docs',
      records,
      search,
      dense,
    })

    const hits = await retriever.retrieve('pricing')

    expect(hits).toHaveLength(1)
    expect(hits[0].content).toBe('new pricing details')
  })

    it('defaults to dense and sparse search when both dense and sparse embeddings are configured', async () => {
    const dense = createDenseEmbedding()
    const sparse = createSparseEmbedding()
    const records = inMemoryRecordStore()
    const search = inMemorySearchStore()
    const searchSpy = vi.spyOn(search, 'search').mockResolvedValue([])

    const retriever = makeRetriever({
      id: 'r1',
      namespace: 'docs',
      records,
      search,
      dense,
      sparse,
    })

    expect(retriever.mode).toBe('search')
    await retriever.retrieve('hybrid query')
    expect(searchSpy).toHaveBeenCalledWith(expect.objectContaining({
      legs: [
        expect.objectContaining({ kind: 'dense' }),
        expect.objectContaining({ kind: 'sparse' }),
      ],
    }))
  })

    it('throws when a store-backed retriever is missing a dense embedding', async () => {
    const retriever = makeRetriever({
        id: 'r1',
        namespace: 'docs',
        records: inMemoryRecordStore(),
        search: inMemorySearchStore(),
      } as any)
    await expect(retriever.retrieve('query')).rejects.toMatchObject({ code: 'unsupported_capability' })
  })

    it('throws when a store-backed retriever has no search store', () => {
    const dense = createDenseEmbedding()

    expect(() =>
      makeRetriever({
        id: 'r1',
        namespace: 'docs',
        records: inMemoryRecordStore(),
        dense,
      }),
    ).toThrow('Store-backed retriever requires search.search().')
  })

    it('throws when sparse retrieval is configured without a search store', () => {
    const sparse = createSparseEmbedding()

    expect(() =>
      makeRetriever({
        id: 'r1',
        namespace: 'docs',
        records: inMemoryRecordStore(),
        sparse,
        plan: { sparse: true },
      }),
    ).toThrow('Store-backed retriever requires search.search().')
  })

    it('throws when search retrieval is configured without a requested embedding', async () => {
    const dense = createDenseEmbedding()

    const retriever = makeRetriever({
        id: 'r1',
        namespace: 'docs',
        records: inMemoryRecordStore(),
        search: inMemorySearchStore(),
        dense,
        plan: { dense: true, sparse: true },
      })
    await expect(retriever.retrieve('query')).rejects.toMatchObject({ code: 'unsupported_capability' })
  })
})
