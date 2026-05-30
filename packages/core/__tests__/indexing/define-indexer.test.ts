import { describe, expect, it, vi } from 'vitest'
import { embedding as makeEmbedding } from '../../embedding'
import { chunker, indexer as makeIndexer, indexingPipeline, transform } from '../../indexing'
import { inMemoryCruxStore } from '../../store/memory'
import type { CruxStore, JsonObject, ListResult } from '../../store/types'

describe('indexer', () => {
  it('uses indexingPipeline() document transforms before structured default chunking', async () => {
    const normalize = vi.fn(async (document: { content: string; metadata?: Record<string, unknown> }) => ({
      ...document,
      content: document.content.replace(/\s+/g, ' ').trim(),
      parts: [{ id: 'text:normalized', kind: 'text' as const, content: document.content.replace(/\s+/g, ' ').trim() }],
      metadata: { ...(document.metadata ?? {}), normalized: true },
    }))
    const indexer = makeIndexer({
      id: 'docs',
      namespace: 'kb',
      store: inMemoryCruxStore(),
      pipeline: indexingPipeline({
        documents: [
          transform.document({
            name: 'normalize',
            version: '1',
            run: normalize,
          }),
        ],
      }),
    })

    const chunks = await indexer.chunk([
      {
        namespace: 'kb',
        sourceId: 'doc-1',
        content: 'Alpha\n\n     Beta',
        parts: [
          { id: 'text:1', kind: 'text', content: 'Alpha' },
          { id: 'text:2', kind: 'text', content: 'Beta' },
        ],
      },
    ])

    expect(normalize).toHaveBeenCalledTimes(1)
    expect(chunks.map((chunk) => chunk.content).join('\n')).toContain('Alpha Beta')
    expect(chunks[0].metadata).toMatchObject({ normalized: true })
  })

  it('structured default chunking preserves table rows, json paths, and source spans', async () => {
    const indexer = makeIndexer({
      id: 'docs',
      namespace: 'kb',
      store: inMemoryCruxStore(),
      pipeline: indexingPipeline({
        chunker: chunker.structured({ tableRowsPerChunk: 1 }),
      }),
    })

    const chunks = await indexer.chunk([
      {
        namespace: 'kb',
        sourceId: 'doc-1',
        content: 'Plan | Price\nFree | 0\nPro | 20\n$.plans[0]: Free',
        parts: [
          {
            id: 'table:pricing',
            kind: 'table',
            content: 'Plan | Price\nFree | 0\nPro | 20',
            columns: ['Plan', 'Price'],
            rows: [
              ['Plan', 'Price'],
              ['Free', '0'],
              ['Pro', '20'],
            ],
            sheetName: 'Pricing',
            rowStart: 1,
            rowEnd: 3,
          },
          {
            id: 'json:plans:0',
            kind: 'json',
            path: '$.plans[0]',
            valueType: 'object',
            content: '$.plans[0]: Free',
          },
        ],
      },
    ])

    const tableChunks = chunks.filter((item) => item.provenance?.tables?.includes('table:pricing'))
    expect(tableChunks.length).toBeGreaterThanOrEqual(2)
    expect(tableChunks[0].content).toContain('Plan | Price')
    expect(tableChunks[0].provenance).toMatchObject({
      partIds: ['table:pricing'],
      sheets: ['Pricing'],
      tables: ['table:pricing'],
      confidence: 'exact',
    })
    expect(tableChunks[0].provenance?.sourceSpans?.[0]).toMatchObject({ partId: 'table:pricing' })
    expect(chunks.some((item) => item.provenance?.jsonPaths?.includes('$.plans[0]'))).toBe(true)
  })

  it('parent-child chunking stores parent records and searchable active child chunks', async () => {
    const store = inMemoryCruxStore()
    const dense = makeEmbedding({
      kind: 'dense',
      name: 'dense-test',
      dimensions: 2,
      maxInputTokens: 100,
      batch: { maxSize: 8 },
      embed: async (texts) => texts.map((text) => [text.length, 1]),
    })
    const indexer = makeIndexer({
      id: 'docs',
      namespace: 'kb',
      store,
      dense,
      pipeline: indexingPipeline({
        chunker: chunker.parentChild({ parentMaxChars: 20, childMaxChars: 8, childOverlapChars: 0 }),
      }),
    })

    await indexer.indexDocuments([
      {
        namespace: 'kb',
        sourceId: 'doc-parent',
        title: 'Parent Doc',
        content: 'Alpha beta gamma delta epsilon zeta eta theta.',
      },
    ])

    const entries = await listAll(store, 'indexer:docs:namespace:kb:source:doc-parent:')
    const parents = entries.entries.filter((entry) => entry.value._cruxRecordType === 'parent')
    const chunks = entries.entries.filter((entry) => entry.value._cruxRecordType === 'chunk')

    expect(parents.length).toBeGreaterThan(0)
    expect(chunks.length).toBeGreaterThan(0)
    expect(chunks.every((entry) => entry.value.active === true)).toBe(true)
    expect(chunks[0].value.parent).toMatchObject({ parentId: parents[0].value.parentId })
    expect(chunks[0].value.embedding).toBeDefined()
  })

  it('stage-level cache reuses document transform output and supports bypass', async () => {
    const store = inMemoryCruxStore()
    const run = vi.fn(async (document: { content: string }) => ({ ...document, content: `${document.content}!` }))
    const indexer = makeIndexer({
      id: 'docs',
      namespace: 'kb',
      store,
      pipeline: indexingPipeline({
        documents: [transform.document({ name: 'bang', version: '1', run })],
      }),
      cache: true,
    })

    await indexer.chunk([{ namespace: 'kb', sourceId: 'doc-cache', content: 'Hello' }])
    await indexer.chunk([{ namespace: 'kb', sourceId: 'doc-cache', content: 'Hello' }])
    await indexer.chunk([{ namespace: 'kb', sourceId: 'doc-cache', content: 'Hello' }], { cache: 'bypass' })

    expect(run).toHaveBeenCalledTimes(2)
  })

  it('generation-aware replacement keeps the previous generation active if a later pipeline fails', async () => {
    const store = inMemoryCruxStore()
    let shouldFail = false
    const indexer = makeIndexer({
      id: 'docs',
      namespace: 'kb',
      store,
      pipeline: indexingPipeline({
        documents: [
          transform.document({
            name: 'maybe-fail',
            version: '1',
            run: (document) => {
              if (shouldFail) throw new Error('pipeline failed')
              return document
            },
          }),
        ],
      }),
    })

    await indexer.indexDocuments([{ namespace: 'kb', sourceId: 'doc-gen', content: 'First version' }])
    const firstEntries = await listAll(store, 'indexer:docs:namespace:kb:source:doc-gen:')
    const firstActiveChunks = firstEntries.entries.filter(
      (entry) => entry.value._cruxRecordType === 'chunk' && entry.value.active === true,
    )
    shouldFail = true

    await expect(
      indexer.indexDocuments([{ namespace: 'kb', sourceId: 'doc-gen', content: 'Second version' }]),
    ).rejects.toThrow('pipeline failed')

    const afterFailure = await listAll(store, 'indexer:docs:namespace:kb:source:doc-gen:')
    const activeChunks = afterFailure.entries.filter(
      (entry) => entry.value._cruxRecordType === 'chunk' && entry.value.active === true,
    )
    expect(activeChunks.map((entry) => entry.value.generationId)).toEqual(
      firstActiveChunks.map((entry) => entry.value.generationId),
    )
  })

  it('chunks documents with stable source and chunk metadata', async () => {
    const indexer = makeIndexer({
      id: 'docs',
      namespace: 'kb',
      store: inMemoryCruxStore(),
    })

    const chunks = await indexer.chunk(
      [
        {
          namespace: 'kb',
          sourceId: 'doc-1',
          title: 'Pricing',
          content: 'Para one.\n\nPara two.\n\nPara three.',
          metadata: { topic: 'pricing' },
        },
      ],
      {
        chunking: { maxChars: 12, overlapChars: 0 },
      },
    )

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[0]).toMatchObject({
      namespace: 'kb',
      sourceId: 'doc-1',
      chunkId: expect.stringMatching(/^chunk_/),
      ordinal: 0,
      metadata: { topic: 'pricing' },
      parent: { title: 'Pricing' },
    })
    expect(new Set(chunks.map((chunk) => chunk.chunkId)).size).toBe(chunks.length)
  })

  it('preserves coarse structured part provenance on default chunks', async () => {
    const indexer = makeIndexer({
      id: 'docs',
      namespace: 'kb',
      store: inMemoryCruxStore(),
    })

    const chunks = await indexer.chunk([
      {
        namespace: 'kb',
        sourceId: 'doc-1',
        content: '[Page 1]\nHello\n\n[Table]\nPlan | Price',
        parts: [
          { id: 'pdf:page:1', kind: 'page', pageNumber: 1, content: 'Hello' },
          {
            id: 'csv:table:1',
            kind: 'table',
            rows: [['Plan', 'Price']],
            pageNumber: 1,
            content: 'Plan | Price',
          },
        ],
      },
    ])

    const pageChunk = chunks.find((chunk) => chunk.provenance?.partIds?.includes('pdf:page:1'))
    const tableChunk = chunks.find((chunk) => chunk.provenance?.partIds?.includes('csv:table:1'))

    expect(pageChunk?.provenance).toMatchObject({
      partIds: ['pdf:page:1'],
      pages: [1],
      confidence: 'exact',
    })
    expect(tableChunk?.provenance).toMatchObject({
      partIds: ['csv:table:1'],
      pages: [1],
      tables: ['csv:table:1'],
      confidence: 'exact',
    })
  })

  it('applies overlap between adjacent chunks', async () => {
    const indexer = makeIndexer({
      id: 'docs',
      namespace: 'kb',
      store: inMemoryCruxStore(),
    })

    const chunks = await indexer.chunk(
      [
        {
          namespace: 'kb',
          sourceId: 'doc-1',
          content: 'abcdefghijklmnopqrstuvwxyz',
        },
      ],
      {
        chunking: { maxChars: 10, overlapChars: 3 },
      },
    )

    expect(chunks).toHaveLength(3)
    expect(chunks[0].content).toBe('abcdefghij')
    expect(chunks[1].content.startsWith('hij')).toBe(true)
  })

  it('uses a custom chunker when provided', async () => {
    const customChunker = {
      _tag: 'Chunker' as const,
      name: 'custom',
      version: '1',
      fingerprint: () => 'custom:1',
      chunkDocument: vi.fn(async (document: { namespace: string; sourceId: string; content: string; metadata?: Record<string, unknown> }) => ({
        chunks: [
          {
            namespace: document.namespace,
            sourceId: document.sourceId,
            chunkId: 'custom-0',
            ordinal: 0,
            content: document.content.toUpperCase(),
            metadata: document.metadata ?? {},
          },
        ],
      })),
    }
    const indexer = makeIndexer({
      id: 'docs',
      namespace: 'kb',
      store: inMemoryCruxStore(),
      pipeline: indexingPipeline({ chunker: customChunker }),
    })

    const chunks = await indexer.chunk([
      {
        namespace: 'kb',
        sourceId: 'doc-1',
        content: 'hello',
      },
    ])

    expect(customChunker.chunkDocument).toHaveBeenCalledTimes(1)
    expect(chunks[0].chunkId).toBe('custom-0')
    expect(chunks[0].content).toBe('HELLO')
  })

  it('indexes documents with dense embeddings and replace-by-source semantics', async () => {
    const store = inMemoryCruxStore()
    const dense = makeEmbedding({
      kind: 'dense',
      name: 'dense-test',
      dimensions: 2,
      maxInputTokens: 100,
      batch: { maxSize: 8 },
      embed: async (texts) => texts.map((text) => [text.length, 1]),
    })
    const indexer = makeIndexer({
      id: 'docs',
      namespace: 'kb',
      store,
      dense,
    })

    await indexer.indexDocuments([
      {
        namespace: 'kb',
        sourceId: 'doc-1',
        content: 'first version',
      },
    ])

    const firstPass = await listAll(store, 'indexer:docs:namespace:kb:source:doc-1:')
    expect(firstPass.entries).toHaveLength(1)
    expect(firstPass.entries[0].value.embedding).toEqual([13, 1])

    await indexer.indexDocuments(
      [
        {
          namespace: 'kb',
          sourceId: 'doc-1',
          content: 'updated version with more text',
        },
      ],
      {
        chunking: { maxChars: 12, overlapChars: 0 },
      },
    )

    const secondPass = await listAll(store, 'indexer:docs:namespace:kb:source:doc-1:')
    expect(secondPass.entries.length).toBeGreaterThan(1)
    expect(secondPass.entries.every((entry) => entry.value.sourceId === 'doc-1')).toBe(true)
  })

  it('indexes documents from an AsyncIterable source', async () => {
    const store = inMemoryCruxStore()
    const dense = makeEmbedding({
      kind: 'dense',
      name: 'dense-test',
      dimensions: 2,
      maxInputTokens: 100,
      batch: { maxSize: 8 },
      embed: async (texts) => texts.map((text) => [text.length, 1]),
    })
    const indexer = makeIndexer({
      id: 'docs',
      namespace: 'kb',
      store,
      dense,
    })

    async function* documents() {
      yield {
        namespace: 'kb' as const,
        sourceId: 'doc-async',
        content: 'hello from async iterable',
      }
    }

    const result = await indexer.indexDocuments(documents())
    const entries = await listAll(store, 'indexer:docs:namespace:kb:source:doc-async:')

    expect(result.sourceCount).toBe(1)
    expect(entries.entries).toHaveLength(1)
    expect(entries.entries[0].value.embedding).toEqual([25, 1])
  })

  it('dry-runs document indexing without mutating the store', async () => {
    const store = inMemoryCruxStore()
    const embed = vi.fn(async (texts: string[]) => texts.map((text) => [text.length, 1]))
    const dense = makeEmbedding({
      kind: 'dense',
      name: 'dense-test',
      dimensions: 2,
      maxInputTokens: 100,
      batch: { maxSize: 8 },
      embed,
    })
    const indexer = makeIndexer({
      id: 'docs',
      namespace: 'kb',
      store,
      dense,
    })

    const result = await indexer.indexDocuments(
      [
        {
          namespace: 'kb',
          sourceId: 'doc-dry',
          content: 'Alpha\n\nBeta',
        },
      ],
      {
        dryRun: true,
        chunking: { maxChars: 10, overlapChars: 0 },
      },
    )

    expect(result).toMatchObject({
      namespace: 'kb',
      sourceCount: 1,
      dryRun: true,
      embeddings: { dense: true, sparse: false },
    })
    expect(result.chunkCount).toBeGreaterThan(1)
    expect(result.chunks.map((chunk) => chunk.sourceId)).toEqual(['doc-dry', 'doc-dry'])
    expect(embed).toHaveBeenCalledTimes(1)
    expect((await listAll(store, 'indexer:docs:namespace:kb:source:doc-dry:')).entries).toHaveLength(0)
  })

  it('indexes chunks with sparse embeddings', async () => {
    const store = inMemoryCruxStore()
    const sparse = makeEmbedding({
      kind: 'sparse',
      name: 'sparse-test',
      maxInputTokens: 100,
      batch: { maxSize: 8 },
      embed: async (texts) =>
        texts.map((text) => ({
          indices: text.split('').map((_, index) => index),
          values: text.split('').map(() => 1),
        })),
    })
    const indexer = makeIndexer({
      id: 'docs',
      namespace: 'kb',
      store,
      sparse,
    })

    const result = await indexer.indexChunks([
      {
        namespace: 'kb',
        sourceId: 'doc-1',
        chunkId: 'a',
        ordinal: 0,
        content: 'hello',
        metadata: {},
      },
    ])

    expect(result.chunkCount).toBe(1)
    const stored = await store.get('indexer:docs:namespace:kb:source:doc-1:chunk:a')
    expect(stored?.sparseEmbedding).toEqual({
      indices: [0, 1, 2, 3, 4],
      values: [1, 1, 1, 1, 1],
    })
  })

  it('indexes chunks with dense and sparse embeddings together', async () => {
    const store = inMemoryCruxStore()
    const dense = makeEmbedding({
      kind: 'dense',
      name: 'dense-test',
      dimensions: 2,
      maxInputTokens: 100,
      batch: { maxSize: 8 },
      embed: async (texts) => texts.map((text) => [text.length, 1]),
    })
    const sparse = makeEmbedding({
      kind: 'sparse',
      name: 'sparse-test',
      maxInputTokens: 100,
      batch: { maxSize: 8 },
      embed: async (texts) =>
        texts.map((text) => ({
          indices: text.split('').map((_, index) => index),
          values: text.split('').map(() => 1),
        })),
    })
    const indexer = makeIndexer({
      id: 'docs',
      namespace: 'kb',
      store,
      dense,
      sparse,
    })

    await indexer.indexChunks([
      {
        namespace: 'kb',
        sourceId: 'doc-1',
        chunkId: 'a',
        ordinal: 0,
        content: 'hello',
        metadata: {},
      },
    ])

    const stored = await store.get('indexer:docs:namespace:kb:source:doc-1:chunk:a')
    expect(stored?.embedding).toEqual([5, 1])
    expect(stored?.sparseEmbedding).toBeDefined()
  })

  it('deleteSource removes only matching namespace/source entries', async () => {
    const store = inMemoryCruxStore()
    await store.set('indexer:docs:namespace:kb:source:doc-1:chunk:0', {
      namespace: 'kb',
      sourceId: 'doc-1',
      chunkId: '0',
      ordinal: 0,
      content: 'a',
      metadata: {},
    })
    await store.set('indexer:docs:namespace:kb:source:doc-1:chunk:1', {
      namespace: 'kb',
      sourceId: 'doc-1',
      chunkId: '1',
      ordinal: 1,
      content: 'b',
      metadata: {},
    })
    await store.set('indexer:docs:namespace:kb:source:doc-2:chunk:0', {
      namespace: 'kb',
      sourceId: 'doc-2',
      chunkId: '0',
      ordinal: 0,
      content: 'c',
      metadata: {},
    })

    const indexer = makeIndexer({
      id: 'docs',
      namespace: 'kb',
      store,
    })

    const deleted = await indexer.deleteSource('doc-1')
    expect(deleted).toBe(2)
    expect(await store.get('indexer:docs:namespace:kb:source:doc-1:chunk:0')).toBeNull()
    expect(await store.get('indexer:docs:namespace:kb:source:doc-2:chunk:0')).not.toBeNull()
  })

  it('clear removes all entries for the indexer namespace', async () => {
    const store = inMemoryCruxStore()
    await store.set('indexer:docs:namespace:kb:source:doc-1:chunk:0', {
      namespace: 'kb',
      sourceId: 'doc-1',
      chunkId: '0',
      ordinal: 0,
      content: 'a',
      metadata: {},
    })
    await store.set('indexer:docs:namespace:kb:source:doc-2:chunk:0', {
      namespace: 'kb',
      sourceId: 'doc-2',
      chunkId: '0',
      ordinal: 0,
      content: 'b',
      metadata: {},
    })
    await store.set('indexer:docs:namespace:other:source:doc-3:chunk:0', {
      namespace: 'other',
      sourceId: 'doc-3',
      chunkId: '0',
      ordinal: 0,
      content: 'c',
      metadata: {},
    })

    const indexer = makeIndexer({
      id: 'docs',
      namespace: 'kb',
      store,
    })

    const deleted = await indexer.clear()
    expect(deleted).toBe(2)
    expect(await store.get('indexer:docs:namespace:other:source:doc-3:chunk:0')).not.toBeNull()
  })
})

async function listAll(store: CruxStore, prefix: string): Promise<ListResult> {
  const entries: Array<{ key: string; value: JsonObject }> = []
  let cursor: string | undefined

  while (true) {
    const page = await store.list(prefix, { cursor, limit: 100 })
    entries.push(...page.entries)
    if (!page.cursor) {
      return { entries }
    }
    cursor = page.cursor
  }
}
