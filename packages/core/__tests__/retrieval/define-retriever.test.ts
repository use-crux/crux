import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { embedding as makeEmbedding } from '../../embedding'
import { indexer as makeIndexer } from '../../indexing'
import { retriever as makeRetriever, reranker as makeReranker } from '../../retrieval'
import { inMemoryDataStore, inMemoryVectorStore } from '../../storage'
import { inMemoryCruxStore } from '../../store/memory'
import type { CruxStore, JsonObject, ListResult, ScoredEntry, VectorSearchQuery } from '../../store/types'

function createDenseEmbedding() {
  return makeEmbedding({
    kind: 'dense',
    name: 'test-dense',
    dimensions: 2,
    maxInputTokens: 100,
    batch: { maxSize: 8 },
    embed: async (texts) => texts.map((text) => [text.length, text.length / 2]),
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

function createScoredEntry(
  key: string,
  value: Partial<JsonObject> & {
    namespace: string
    sourceId: string
    chunkId: string
    content: string
  },
  score: number,
): ScoredEntry {
  return {
    key,
    score,
    value: {
      namespace: value.namespace,
      sourceId: value.sourceId,
      chunkId: value.chunkId,
      content: value.content,
      metadata: value.metadata ?? {},
      ...(value.parent ? { parent: value.parent } : {}),
      ...(value.sourceUrl ? { sourceUrl: value.sourceUrl } : {}),
      ...(value.sourcePath ? { sourcePath: value.sourcePath } : {}),
    },
  }
}

function createBaseStore(overrides: Partial<CruxStore> = {}): CruxStore {
  return {
    get: async () => null,
    set: async () => {},
    delete: async () => {},
    list: async (): Promise<ListResult> => ({ entries: [] }),
    ...overrides,
  }
}

describe('retriever', () => {
  it('uses explicit data and vector stores for dense retrieval', async () => {
    const data = inMemoryDataStore()
    const vectors = inMemoryVectorStore()

    await data.set('chunk:1', {
      _cruxRecordType: 'chunk',
      namespace: 'docs',
      sourceId: 'intro.md',
      chunkId: '0',
      content: 'Alpha',
      metadata: {},
      active: true,
    })
    await vectors.upsert([{ key: 'chunk:1', dense: [5, 2.5] }])

    const retriever = makeRetriever({
      id: 'docs',
      namespace: 'docs',
      data,
      vectors,
      dense: createDenseEmbedding(),
      search: { mode: 'dense' },
    })

    const hits = await retriever.retrieve('alpha')

    expect(hits).toEqual([
      expect.objectContaining({
        sourceId: 'intro.md',
        chunkId: '0',
        content: 'Alpha',
      }),
    ])
    expect(hits[0]?.score).toBeCloseTo(1)
  })

    it('retrieves chunks indexed into explicit data and vector stores', async () => {
    const data = inMemoryDataStore()
    const vectors = inMemoryVectorStore()
    const dense = createDenseEmbedding()
    const indexer = makeIndexer({
      id: 'docs',
      namespace: 'docs',
      data,
      vectors,
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
      data,
      vectors,
      dense,
      search: { mode: 'dense' },
    })

    const hits = await retriever.retrieve('Alpha')

    expect(hits).toEqual([
      expect.objectContaining({
        sourceId: 'guide.md',
        content: 'Alpha',
      }),
    ])
  })

    it('applies rerankers after retrieval', async () => {
    const reranker = makeReranker({
      name: 'reverse-top-1',
      rerank: async ({ query, hits }) => {
        expect(query).toBe('launch')
        return [...hits].reverse().slice(0, 1)
      },
    })

    const retriever = makeRetriever({
      id: 'r1',
      namespace: 'docs',
      retrieve: async () => [
        {
          namespace: 'docs',
          sourceId: 'doc-1',
          chunkId: '0',
          content: 'First result',
          metadata: {},
          score: 0.9,
        },
        {
          namespace: 'docs',
          sourceId: 'doc-2',
          chunkId: '1',
          content: 'Second result',
          metadata: {},
          score: 0.8,
        },
      ],
      rerank: reranker,
    })

    const hits = await retriever.retrieve('launch')

    expect(hits).toEqual([
      {
        namespace: 'docs',
        sourceId: 'doc-2',
        chunkId: '1',
        content: 'Second result',
        metadata: {},
        score: 0.8,
      },
    ])
  })

    it('applies multiple rerankers sequentially', async () => {
    const addMarker = makeReranker({
      name: 'add-marker',
      rerank: ({ hits }) =>
        hits.map((hit) => ({
          ...hit,
          metadata: { ...hit.metadata, reranked: true },
        })),
    })
    const trim = makeReranker({
      name: 'trim',
      rerank: ({ hits }) => hits.slice(0, 1),
    })

    const retriever = makeRetriever({
      id: 'r1',
      namespace: 'docs',
      retrieve: async () => [
        {
          namespace: 'docs',
          sourceId: 'doc-1',
          chunkId: '0',
          content: 'First result',
          metadata: {},
          score: 0.9,
        },
        {
          namespace: 'docs',
          sourceId: 'doc-2',
          chunkId: '1',
          content: 'Second result',
          metadata: {},
          score: 0.8,
        },
      ],
      rerank: [addMarker, trim],
    })

    const hits = await retriever.retrieve('launch')

    expect(hits).toEqual([
      {
        namespace: 'docs',
        sourceId: 'doc-1',
        chunkId: '0',
        content: 'First result',
        metadata: { reranked: true },
        score: 0.9,
      },
    ])
  })

    it('reranker requires a non-empty name', () => {
    expect(() =>
      makeReranker({
        name: '   ',
        rerank: ({ hits }) => hits,
      }),
    ).toThrow('Reranker name must be non-empty')
  })

    it('retrieves dense hits via vectorSearch and enforces namespace filter', async () => {
    const dense = createDenseEmbedding()
    const vectorSearch = vi.fn(async (_embedding: number[], options?: { limit?: number; threshold?: number; filter?: Record<string, unknown> }) => {
      expect(options?.limit).toBe(3)
      expect(options?.threshold).toBe(0.4)
      expect(options?.filter).toEqual({
        topic: 'launch',
        namespace: 'docs',
        _cruxRecordType: 'chunk',
        active: true,
      })
      return [
        createScoredEntry(
          'retriever:r1:source:doc-1:chunk:0',
          {
            namespace: 'docs',
            sourceId: 'doc-1',
            chunkId: '0',
            content: 'Launch checklist',
            metadata: { topic: 'launch' },
            parent: { title: 'Launch Plan' },
          },
          0.92,
        ),
      ]
    })
    const store = createBaseStore({ vectorSearch })

    const retriever = makeRetriever({
      id: 'r1',
      namespace: 'docs',
      store,
      dense,
      search: {
        limit: 2,
        filter: { topic: 'launch' },
      },
    })

    const hits = await retriever.retrieve('launch steps', { limit: 3, threshold: 0.4 })

    expect(vectorSearch).toHaveBeenCalledTimes(1)
    expect(hits).toEqual([
      {
        namespace: 'docs',
        sourceId: 'doc-1',
        chunkId: '0',
        content: 'Launch checklist',
        metadata: { topic: 'launch' },
        score: 0.92,
        parent: { title: 'Launch Plan' },
      },
    ])
  })

    it('falls back to searchVectors for dense retrieval when vectorSearch is absent', async () => {
    const dense = createDenseEmbedding()
    const searchVectors = vi.fn(async (query: VectorSearchQuery) => {
      expect(query.dense).toEqual([13, 6.5])
      expect(query.limit).toBe(4)
      expect(query.filter).toEqual({ namespace: 'docs', _cruxRecordType: 'chunk', active: true })
      return [
        createScoredEntry(
          'retriever:r1:source:doc-2:chunk:1',
          {
            namespace: 'docs',
            sourceId: 'doc-2',
            chunkId: '1',
            content: 'Roadmap notes',
            metadata: {},
          },
          0.88,
        ),
      ]
    })
    const store = createBaseStore({ searchVectors })

    const retriever = makeRetriever({
      id: 'r1',
      namespace: 'docs',
      store,
      dense,
    })

    const hits = await retriever.retrieve('roadmap query', { limit: 4 })

    expect(searchVectors).toHaveBeenCalledTimes(1)
    expect(hits[0].sourceId).toBe('doc-2')
  })

    it('asContext renders retrieved hits from a static query', async () => {
    const retriever = makeRetriever({
      id: 'r1',
      namespace: 'docs',
      retrieve: async () => [
        {
          namespace: 'docs',
          sourceId: 'doc-1',
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

    it('injects search tools by default when used directly in a prompt', async () => {
    const { prompt } = await import('../../prompt/prompt')
    const retriever = makeRetriever({
      id: 'docs',
      namespace: 'docs',
      retrieve: async () => [
        {
          namespace: 'docs',
          sourceId: 'doc-1',
          chunkId: '0',
          content: 'Release notes',
          metadata: {},
          score: 0.93,
        },
      ],
    })
    const answer = prompt({ use: [retriever], system: 'Base.' })

    const resolved = await answer.resolve({})

    expect(resolved.system).toBe('Base.')
    expect(resolved.tools?.search).toBeDefined()
    expect(await (resolved.tools?.search as any).execute({ query: 'release', limit: 1 })).toContain('Release notes')
  })

    it('injects context by default when context query is configured', async () => {
    const { prompt } = await import('../../prompt/prompt')
    const retriever = makeRetriever({
      id: 'docs',
      namespace: 'docs',
      retrieve: async () => [
        {
          namespace: 'docs',
          sourceId: 'doc-1',
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
        sourceId: 'doc-3',
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

    it('exposes query and source tools', async () => {
    const retriever = makeRetriever({
      id: 'r1',
      namespace: 'docs',
      retrieve: async (query, options) => [
        {
          namespace: 'docs',
          sourceId: 'doc-4',
          chunkId: '1',
          content: `${query}:${options.limit}`,
          metadata: { kind: 'note' },
          score: 0.7,
        },
      ],
    })

    const tools = retriever.asTools({ include: ['search', 'getSource'] })
    expect(Object.keys(tools)).toEqual(['search', 'getSource'])
    expect(tools.search.parameters.safeParse({ query: 'ops', limit: 2 }).success).toBe(true)

    const result = JSON.parse(await tools.search.execute({ query: 'ops', limit: 2 }))
    expect(result).toEqual([
      {
        namespace: 'docs',
        sourceId: 'doc-4',
        chunkId: '1',
        content: 'ops:2',
        metadata: { kind: 'note' },
        score: 0.7,
      },
    ])
    await expect(tools.getSource.execute({ sourceId: 'doc-4', chunkId: '1' })).resolves.toContain('ops:2')
  })

    it('supports a fully custom retriever', async () => {
    const retriever = makeRetriever({
      id: 'r1',
      namespace: 'docs',
      retrieve: async (query) => [
        {
          namespace: 'docs',
          sourceId: 'custom-source',
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

    it('retrieves sparse hits through searchVectors', async () => {
    const sparse = createSparseEmbedding()
    const searchVectors = vi.fn(async (query: VectorSearchQuery) => {
      expect(query.sparse).toEqual({
        indices: [0, 1, 2, 3, 4, 5],
        values: [1, 1, 1, 1, 1, 1],
      })
      expect(query.filter).toEqual({ namespace: 'docs', _cruxRecordType: 'chunk', active: true })
      return [
        createScoredEntry(
          'retriever:r1:source:doc-5:chunk:0',
          {
            namespace: 'docs',
            sourceId: 'doc-5',
            chunkId: '0',
            content: 'Sparse hit',
            metadata: { mode: 'sparse' },
          },
          0.77,
        ),
      ]
    })
    const store = createBaseStore({ searchVectors })

    const retriever = makeRetriever({
      id: 'r1',
      namespace: 'docs',
      store,
      sparse,
      search: { mode: 'sparse' },
    })

    const hits = await retriever.retrieve('sparse', {})

    expect(retriever.mode).toBe('sparse')
    expect(searchVectors).toHaveBeenCalledTimes(1)
    expect(hits[0].metadata).toEqual({ mode: 'sparse' })
  })

    it('retrieves hybrid hits through searchVectors with fusion', async () => {
    const dense = createDenseEmbedding()
    const sparse = createSparseEmbedding()
    const searchVectors = vi.fn(async (query: VectorSearchQuery) => {
      expect(query.dense).toEqual([6, 3])
      expect(query.sparse).toEqual({
        indices: [0, 1, 2, 3, 4, 5],
        values: [1, 1, 1, 1, 1, 1],
      })
      expect(query.fusion).toBe('rrf')
      return [
        createScoredEntry(
          'retriever:r1:source:doc-6:chunk:1',
          {
            namespace: 'docs',
            sourceId: 'doc-6',
            chunkId: '1',
            content: 'Hybrid hit',
            metadata: { mode: 'hybrid' },
          },
          0.91,
        ),
      ]
    })
    const store = createBaseStore({ searchVectors })

    const retriever = makeRetriever({
      id: 'r1',
      namespace: 'docs',
      store,
      dense,
      sparse,
      search: { mode: 'hybrid', fusion: 'rrf' },
    })

    const hits = await retriever.retrieve('hybrid')

    expect(retriever.mode).toBe('hybrid')
    expect(searchVectors).toHaveBeenCalledTimes(1)
    expect(hits[0].content).toBe('Hybrid hit')
  })

    it('retrieves chunks that were indexed through indexer', async () => {
    const store = inMemoryCruxStore()
    const dense = makeEmbedding({
      kind: 'dense',
      name: 'integration-dense',
      dimensions: 2,
      maxInputTokens: 100,
      batch: { maxSize: 8 },
      embed: async (texts) =>
        texts.map((text) => {
          const normalized = text.toLowerCase()
          return normalized.includes('pricing') ? [1, 0] : [0, 1]
        }),
    })
    const indexer = makeIndexer({
      id: 'docs',
      namespace: 'docs',
      store,
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
      store,
      dense,
      search: { limit: 1 },
    })

    const hits = await retriever.retrieve('pricing')

    expect(hits).toHaveLength(1)
    expect(hits[0].sourceId).toBe('pricing-doc')
    expect(hits[0].parent).toEqual({ title: 'Pricing' })
  })

    it('excludes inactive generations and parent records from indexed retrieval', async () => {
    const store = inMemoryCruxStore()
    const dense = makeEmbedding({
      kind: 'dense',
      name: 'integration-dense',
      dimensions: 2,
      maxInputTokens: 100,
      batch: { maxSize: 8 },
      embed: async (texts) => texts.map((text) => (text.includes('pricing') ? [1, 0] : [0, 1])),
    })
    const indexer = makeIndexer({
      id: 'docs',
      namespace: 'docs',
      store,
      dense,
    })

    await indexer.indexDocuments([{ namespace: 'docs', sourceId: 'pricing-doc', content: 'old pricing details' }])
    await indexer.indexDocuments([{ namespace: 'docs', sourceId: 'pricing-doc', content: 'new pricing details' }])
    await store.set('indexer:docs:namespace:docs:source:pricing-doc:parent:manual', {
      _cruxRecordType: 'parent',
      namespace: 'docs',
      sourceId: 'pricing-doc',
      parentId: 'manual',
      active: true,
      content: 'pricing parent',
      metadata: {},
      embedding: [1, 0],
    })

    const retriever = makeRetriever({
      id: 'r1',
      namespace: 'docs',
      store,
      dense,
    })

    const hits = await retriever.retrieve('pricing')

    expect(hits).toHaveLength(1)
    expect(hits[0].content).toBe('new pricing details')
  })

    it('defaults to hybrid mode when both dense and sparse embeddings are configured', async () => {
    const dense = createDenseEmbedding()
    const sparse = createSparseEmbedding()
    const searchVectors = vi.fn(async () => [])
    const store = createBaseStore({ searchVectors })

    const retriever = makeRetriever({
      id: 'r1',
      namespace: 'docs',
      store,
      dense,
      sparse,
    })

    expect(retriever.mode).toBe('hybrid')
    await retriever.retrieve('hybrid query')
    expect(searchVectors).toHaveBeenCalledTimes(1)
  })

    it('throws when a store-backed retriever is missing a dense embedding', () => {
    const store = createBaseStore({
      vectorSearch: async () => [],
    })

    expect(() =>
      makeRetriever({
        id: 'r1',
        namespace: 'docs',
        store,
      } as any),
    ).toThrow('requires a dense embedding')
  })

    it('throws when a dense store-backed retriever has no search capability', () => {
    const dense = createDenseEmbedding()
    const store = createBaseStore()

    expect(() =>
      makeRetriever({
        id: 'r1',
        namespace: 'docs',
        store,
        dense,
      }),
    ).toThrow('requires vectors.search(), store.vectorSearch(), or store.searchVectors()')
  })

    it('throws when sparse retrieval is configured without searchVectors', () => {
    const sparse = createSparseEmbedding()
    const store = createBaseStore({
      vectorSearch: async () => [],
    })

    expect(() =>
      makeRetriever({
        id: 'r1',
        namespace: 'docs',
        store,
        sparse,
        search: { mode: 'sparse' },
      }),
    ).toThrow('requires vectors.search() or store.searchVectors()')
  })

    it('throws when hybrid retrieval is configured without both embeddings', () => {
    const dense = createDenseEmbedding()
    const store = createBaseStore({
      searchVectors: async () => [],
    })

    expect(() =>
      makeRetriever({
        id: 'r1',
        namespace: 'docs',
        store,
        dense,
        search: { mode: 'hybrid' },
      }),
    ).toThrow('requires both dense and sparse embeddings')
  })
})
