import { describe, expect, it } from 'vitest'
import { createIndexedKnowledgeStore } from '../../src/indexed-knowledge'
import { indexedChunkKey } from '../../src/indexed-knowledge/keys'
import { inMemoryRecordStore, inMemorySearchStore } from '../../src/storage'
import type { SearchHit, SearchStore } from '../../src/storage'

describe('indexed knowledge store', () => {
  it('persists only validated allowlisted source facts outside search metadata', async () => {
    const data = inMemoryRecordStore()
    const search = inMemorySearchStore()
    const records = createIndexedKnowledgeStore({ indexerId: 'docs', namespace: 'kb', records: data, search })

    await records.persistGeneration({
      chunks: [{
        namespace: 'kb', sourceId: 'visual', chunkId: 'page-2', ordinal: 0, content: 'diagram',
        metadata: { topic: 'architecture', sourceUrl: 'https://evil.example/signed?token=secret' },
        source: {
          url: 'https://example.com/manual.pdf', path: '/docs/manual.pdf', assetRef: { uri: 'asset://manual' },
          mediaType: 'application/pdf', location: { type: 'page', pageNumber: 2 },
        },
      }],
      parents: [], dense: [[1, 0]], replaceSources: true,
    })

    const stored = await data.get(indexedChunkKey('docs', 'kb', 'visual', 'page-2'))
    expect(stored?.source).toEqual({
      url: 'https://example.com/manual.pdf', path: '/docs/manual.pdf', assetRef: { uri: 'asset://manual' },
      mediaType: 'application/pdf', location: { type: 'page', pageNumber: 2 },
    })
    const vector = await search.search({ legs: [{ kind: 'dense', vector: [1, 0] }], limit: 1 })
    expect(vector[0]?.metadata).toEqual({
      _cruxRecordType: 'chunk', namespace: 'kb', sourceId: 'visual', chunkId: 'page-2',
      generationId: expect.any(String), active: true, topic: 'architecture',
    })
    expect(JSON.stringify(vector[0]?.metadata)).not.toMatch(/asset:\/\/|manual\.pdf|pageNumber/)
  })

  it('persists generations, searches active chunks, and expands parents through the read model', async () => {
    const data = inMemoryRecordStore()
    const search = inMemorySearchStore()
    const records = createIndexedKnowledgeStore({
      indexerId: 'docs',
      namespace: 'kb',
      records: data,
      search,
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
      legs: { dense: { vector: [1, 0] } },
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

  it('retains dense SearchStore match evidence on hydrated hits', async () => {
    const data = inMemoryRecordStore()
    const search = inMemorySearchStore()
    const records = createIndexedKnowledgeStore({
      indexerId: 'docs',
      namespace: 'kb',
      records: data,
      search,
    })

    await records.persistGeneration({
      chunks: [
        {
          namespace: 'kb',
          sourceId: 'guide',
          chunkId: 'dense',
          ordinal: 0,
          content: 'dense match',
          metadata: {},
        },
      ],
      parents: [],
      dense: [[1, 0]],
      replaceSources: true,
    })

    const [hit] = await records.searchChunks({ legs: { dense: { vector: [1, 0] } }, limit: 1 })

    expect(hit).toMatchObject({ provenance: { matches: [{ kind: 'dense', rank: 1, score: 1 }] } })
  })

  it('retains fused SearchStore matches while preserving stored provenance', async () => {
    const data = inMemoryRecordStore()
    const backingSearch = inMemorySearchStore()
    let capturedSearchHit: SearchHit | undefined
    const search: SearchStore = {
      _tag: 'SearchStore',
      upsert: (records) => backingSearch.upsert(records),
      delete: (keys) => backingSearch.delete(keys),
      capabilities: () => backingSearch.capabilities(),
      search: async (query) => {
        const hits = await backingSearch.search(query)
        capturedSearchHit = hits[0]
        return hits
      },
    }
    const records = createIndexedKnowledgeStore({
      indexerId: 'docs',
      namespace: 'kb',
      records: data,
      search,
    })

    await records.persistGeneration({
      chunks: [
        {
          namespace: 'kb',
          sourceId: 'guide',
          chunkId: 'hybrid',
          ordinal: 0,
          content: 'alpha beta',
          metadata: {},
          provenance: { confidence: 'exact', sourceLocations: [{ type: 'page', pageNumber: 3 }] },
        },
      ],
      parents: [],
      dense: [[1, 0]],
      sparse: [{ indices: [4], values: [2] }],
      replaceSources: true,
    })

    const [hit] = await records.searchChunks({
      legs: {
        dense: { vector: [1, 0] },
        sparse: { vector: { indices: [4], values: [2] } },
      },
      fusion: { strategy: 'rrf' },
      limit: 1,
    })

    expect(hit).toMatchObject({
      provenance: {
        confidence: 'exact',
        sourceLocations: [{ type: 'page', pageNumber: 3 }],
        matches: [
          { kind: 'dense', rank: 1, score: 1 },
          { kind: 'sparse', rank: 1, score: 1 },
        ],
      },
    })

    const provenance = (hit as { readonly provenance?: { readonly matches?: readonly unknown[] } } | undefined)?.provenance
    expect(provenance?.matches).not.toBe(capturedSearchHit?.matches)
    expect(provenance?.matches?.[0]).not.toBe(capturedSearchHit?.matches[0])
  })

  it('clears stored provenance matches when SearchStore returns empty matches', async () => {
    const data = inMemoryRecordStore()
    const backingSearch = inMemorySearchStore()
    const emptyMatches: SearchHit['matches'] = []
    const search: SearchStore = {
      _tag: 'SearchStore',
      upsert: (records) => backingSearch.upsert(records),
      delete: (keys) => backingSearch.delete(keys),
      capabilities: () => backingSearch.capabilities(),
      search: async (query) => {
        const hits = await backingSearch.search(query)
        return hits.map((hit) => ({ ...hit, matches: emptyMatches }))
      },
    }
    const records = createIndexedKnowledgeStore({
      indexerId: 'docs',
      namespace: 'kb',
      records: data,
      search,
    })

    await records.persistGeneration({
      chunks: [
        {
          namespace: 'kb',
          sourceId: 'guide',
          chunkId: 'hybrid',
          ordinal: 0,
          content: 'alpha beta',
          metadata: {},
          provenance: { matches: [{ kind: 'dense', rank: 9, score: 0.1 }] },
        },
      ],
      parents: [],
      dense: [[1, 0]],
      replaceSources: true,
    })

    const [hit] = await records.searchChunks({ legs: { dense: { vector: [1, 0] } }, limit: 1 })
    const provenance = (hit as { readonly provenance?: { readonly matches?: readonly unknown[] } } | undefined)?.provenance

    expect(provenance?.matches).toEqual([])
    expect(provenance?.matches).not.toBe(emptyMatches)
  })

  it('deletes source and namespace records from record and search stores consistently', async () => {
    const data = inMemoryRecordStore()
    const search = inMemorySearchStore()
    const records = createIndexedKnowledgeStore({
      indexerId: 'docs',
      namespace: 'kb',
      records: data,
      search,
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
    await expect(records.searchChunks({ legs: { dense: { vector: [1, 0] } }, threshold: 0.5 })).resolves.toEqual([])
    await expect(records.searchChunks({ legs: { dense: { vector: [0, 1] } }, threshold: 0.5 })).resolves.toHaveLength(1)

    await expect(records.clearNamespace()).resolves.toBe(1)
    await expect(records.searchChunks({ legs: { dense: { vector: [0, 1] } }, threshold: 0.5 })).resolves.toEqual([])
  })

  it('expands parents from derived refs and supports missing-parent errors', async () => {
    const data = inMemoryRecordStore()
    const records = createIndexedKnowledgeStore({
      indexerId: 'docs',
      namespace: 'kb',
      records: data,
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
        source: { id: 'guide' },
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
          source: { id: 'guide' },
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

  it('fails fast when searching without a search store', async () => {
    const data = inMemoryRecordStore()
    const records = createIndexedKnowledgeStore({
      indexerId: 'docs',
      namespace: 'kb',
      records: data,
    })

    await records.persistGeneration({
      chunks: [
        {
          namespace: 'kb',
          sourceId: 'missing-search',
          chunkId: 'a',
          ordinal: 0,
          content: 'chunk',
          metadata: { topic: 'search' },
        },
      ],
      parents: [],
      dense: [[1, 0]],
      replaceSources: true,
    })

    await expect(
      records.searchChunks({
        legs: { dense: { vector: [1, 0] } },
        filter: { namespace: 'kb' },
      }),
    ).rejects.toThrow('Indexed knowledge search requires search')
  })

  it('fails with a hydration diagnostic when search hits cannot be read from records', async () => {
    const data = inMemoryRecordStore()
    const search = inMemorySearchStore()
    const records = createIndexedKnowledgeStore({
      indexerId: 'docs',
      namespace: 'kb',
      records: data,
      search,
    })

    await records.persistGeneration({
      chunks: [
        {
          namespace: 'kb',
          sourceId: 'orphan',
          chunkId: 'a',
          ordinal: 0,
          content: 'orphaned search',
          metadata: { topic: 'diagnostics' },
        },
      ],
      parents: [],
      dense: [[1, 0]],
      replaceSources: true,
    })
    await data.delete(indexedChunkKey('docs', 'kb', 'orphan', 'a'))

    await expect(records.searchChunks({ legs: { dense: { vector: [1, 0] } }, threshold: 0.8 })).rejects.toMatchObject({
      name: 'RetrievalRunError',
      code: 'hydration_miss',
      message: expect.stringContaining('Search hits could not be hydrated'),
    })
  })
})
