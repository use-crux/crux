import { describe, expect, it, vi } from 'vitest'
import { embedding as makeEmbedding } from '../../src/embedding'
import { chunker, indexer as makeIndexer, indexingPipeline, transform } from '../../src/indexing'
import { expandParents, retrievalRecipe, retrieve, retriever as makeRetriever } from '../../src/retrieval'
import { inMemoryRecordStore, inMemorySearchStore } from '../../src/storage'
import type { JsonObject, RecordPage, RecordStore } from '../../src/storage'
import { textOf } from '../embedding/text-input'
import { schema2TextChunk, schema2TextDocument } from '../fixtures/schema2-stored-evidence'

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
      records: inMemoryRecordStore(),
      search: inMemorySearchStore(),
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
      records: inMemoryRecordStore(),
      search: inMemorySearchStore(),
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
      confidence: 'derived',
    })
    expect(tableChunks[0].provenance?.sourceSpans).toBeUndefined()
    expect(chunks.some((item) => item.provenance?.jsonPaths?.includes('$.plans[0]'))).toBe(true)
  })

    it('parent-child chunking stores parent records and searchable active child chunks', async () => {
    const records = inMemoryRecordStore()
    const search = inMemorySearchStore()
    const dense = makeEmbedding({
      kind: 'dense',
      name: 'dense-test',
      dimensions: 2,
      maxInputTokens: 100,
      batch: { maxSize: 8 },
      embed: async (inputs) => inputs.map((input) => (/Alpha|beta/.test(textOf(input)) ? [1, 0] : [0, 1])),
    })
    const indexer = makeIndexer({
      id: 'docs',
      namespace: 'kb',
      records,
      search,
      dense,
      pipeline: indexingPipeline({
        chunker: chunker.parentChild({ parentMaxChars: 20, childMaxChars: 8, childOverlapChars: 0 }),
      }),
    })

    await indexer.indexDocuments([
      schema2TextDocument({
        namespace: 'kb',
        sourceId: 'doc-parent',
        title: 'Parent Doc',
        content: 'Alpha beta gamma delta epsilon zeta eta theta.',
      }),
    ])

    const docs = makeRetriever({ id: 'docs', namespace: 'kb', records, search, dense })
    const expandedDocs = retrievalRecipe({
      id: 'expanded-docs',
      retriever: docs,
      steps: [retrieve(), expandParents({ records, indexerId: 'docs' })],
    }).asRetriever()
    const hits = await expandedDocs.retrieve('Alpha beta')

    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0].content).not.toBe(hits[0].parent?.content)
    expect(hits[0].parent).toMatchObject({
      content: expect.stringContaining('Alpha beta'),
      metadata: {},
    })
  })

    it('stage-level cache reuses document transform output and supports bypass', async () => {
    const records = inMemoryRecordStore()
    const search = inMemorySearchStore()
    const run = vi.fn(async (document: { content: string }) => ({ ...document, content: `${document.content}!` }))
    const indexer = makeIndexer({
      id: 'docs',
      namespace: 'kb',
      records,
      search,
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
    const records = inMemoryRecordStore()
    const search = inMemorySearchStore()
    let shouldFail = false
    const dense = makeEmbedding({
      kind: 'dense',
      name: 'dense-test',
      dimensions: 2,
      maxInputTokens: 100,
      batch: { maxSize: 8 },
      embed: async (inputs) => inputs.map((input) => (textOf(input).includes('First') ? [1, 0] : [0, 1])),
    })
    const indexer = makeIndexer({
      id: 'docs',
      namespace: 'kb',
      records,
      search,
      dense,
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

    await indexer.indexDocuments([schema2TextDocument({ namespace: 'kb', sourceId: 'doc-gen', content: 'First version' })])
    shouldFail = true

    await expect(
      indexer.indexDocuments([schema2TextDocument({ namespace: 'kb', sourceId: 'doc-gen', content: 'Second version' })]),
    ).rejects.toThrow('pipeline failed')

    const docs = makeRetriever({ id: 'docs', namespace: 'kb', records, search, dense })
    const hits = await docs.retrieve('First version', { threshold: 0.5 })
    expect(hits.map((hit) => hit.content)).toEqual(['First version'])
  })

    it('chunks documents with stable source and chunk metadata', async () => {
    const indexer = makeIndexer({
      id: 'docs',
      namespace: 'kb',
      records: inMemoryRecordStore(),
      search: inMemorySearchStore(),
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
      records: inMemoryRecordStore(),
      search: inMemorySearchStore(),
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
      confidence: 'derived',
    })
    expect(tableChunk?.provenance?.sourceSpans).toBeUndefined()
  })

    it('applies overlap between adjacent chunks', async () => {
    const indexer = makeIndexer({
      id: 'docs',
      namespace: 'kb',
      records: inMemoryRecordStore(),
      search: inMemorySearchStore(),
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
      records: inMemoryRecordStore(),
      search: inMemorySearchStore(),
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
    const records = inMemoryRecordStore()
    const search = inMemorySearchStore()
    const dense = makeEmbedding({
      kind: 'dense',
      name: 'dense-test',
      dimensions: 2,
      maxInputTokens: 100,
      batch: { maxSize: 8 },
      embed: async (inputs) => inputs.map((input) => [textOf(input).length, 1]),
    })
    const indexer = makeIndexer({
      id: 'docs',
      namespace: 'kb',
      records,
      search,
      dense,
    })

    await indexer.indexDocuments([
      schema2TextDocument({
        namespace: 'kb',
        sourceId: 'doc-1',
        content: 'first version',
      }),
    ])

    const firstPass = await listAll(records, 'indexer:docs:namespace:kb:source:doc-1:')
    expect(firstPass.entries).toHaveLength(1)
    const docs = makeRetriever({ id: 'docs', namespace: 'kb', records, search, dense })
    await expect(docs.retrieve('first version', { threshold: 0.5 })).resolves.toEqual([
      expect.objectContaining({ source: { id: 'doc-1' }, content: 'first version' }),
    ])

    await indexer.indexDocuments(
      [
        schema2TextDocument({
          namespace: 'kb',
          sourceId: 'doc-1',
          content: 'updated version with more text',
        }),
      ],
      {
        chunking: { maxChars: 12, overlapChars: 0 },
      },
    )

    const secondPass = await listAll(records, 'indexer:docs:namespace:kb:source:doc-1:')
    expect(secondPass.entries.length).toBeGreaterThan(1)
    expect(secondPass.entries.every((entry) => entry.value.sourceId === 'doc-1')).toBe(true)
  })

    it('indexes documents from an AsyncIterable source', async () => {
    const records = inMemoryRecordStore()
    const search = inMemorySearchStore()
    const dense = makeEmbedding({
      kind: 'dense',
      name: 'dense-test',
      dimensions: 2,
      maxInputTokens: 100,
      batch: { maxSize: 8 },
      embed: async (inputs) => inputs.map((input) => [textOf(input).length, 1]),
    })
    const indexer = makeIndexer({
      id: 'docs',
      namespace: 'kb',
      records,
      search,
      dense,
    })

    async function* documents() {
      yield schema2TextDocument({
        namespace: 'kb' as const,
        sourceId: 'doc-async',
        content: 'hello from async iterable',
      })
    }

    const result = await indexer.indexDocuments(documents())
    const entries = await listAll(records, 'indexer:docs:namespace:kb:source:doc-async:')

    expect(result.sourceCount).toBe(1)
    expect(entries.entries).toHaveLength(1)
    const docs = makeRetriever({ id: 'docs', namespace: 'kb', records, search, dense })
    await expect(docs.retrieve('hello from async iterable', { threshold: 0.5 })).resolves.toEqual([
      expect.objectContaining({ source: { id: 'doc-async' }, content: 'hello from async iterable' }),
    ])
  })

    it('dry-runs document indexing without mutating the store', async () => {
    const records = inMemoryRecordStore()
    const search = inMemorySearchStore()
    const embed = vi.fn(async (inputs) => inputs.map((input) => [textOf(input).length, 1]))
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
      records,
      search,
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
    expect((await listAll(records, 'indexer:docs:namespace:kb:source:doc-dry:')).entries).toHaveLength(0)
  })

    it('indexes chunks with sparse embeddings', async () => {
    const records = inMemoryRecordStore()
    const search = inMemorySearchStore()
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
      records,
      search,
      sparse,
    })

    const result = await indexer.indexChunks([
      schema2TextChunk({
        namespace: 'kb',
        sourceId: 'doc-1',
        chunkId: 'a',
        ordinal: 0,
        content: 'hello',
        metadata: {},
      }),
    ])

    expect(result.chunkCount).toBe(1)
    const docs = makeRetriever({
      id: 'docs',
      namespace: 'kb',
      records,
      search,
      sparse,
      plan: { sparse: true },
    })
    await expect(docs.retrieve('hello', { threshold: 0.5 })).resolves.toEqual([
      expect.objectContaining({ source: { id: 'doc-1' }, chunkId: 'a', content: 'hello' }),
    ])
  })

    it('indexes chunks with dense and sparse embeddings together', async () => {
    const records = inMemoryRecordStore()
    const search = inMemorySearchStore()
    const dense = makeEmbedding({
      kind: 'dense',
      name: 'dense-test',
      dimensions: 2,
      maxInputTokens: 100,
      batch: { maxSize: 8 },
      embed: async (inputs) => inputs.map((input) => [textOf(input).length, 1]),
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
      records,
      search,
      dense,
      sparse,
    })

    await indexer.indexChunks([
      schema2TextChunk({
        namespace: 'kb',
        sourceId: 'doc-1',
        chunkId: 'a',
        ordinal: 0,
        content: 'hello',
        metadata: {},
      }),
    ])

    const docs = makeRetriever({
      id: 'docs',
      namespace: 'kb',
      records,
      search,
      dense,
      sparse,
      plan: { dense: true, sparse: true },
    })
    await expect(docs.retrieve('hello', { threshold: 0.5 })).resolves.toEqual([
      expect.objectContaining({ source: { id: 'doc-1' }, chunkId: 'a', content: 'hello' }),
    ])
  })

    it('deleteSource removes only matching namespace/source entries', async () => {
    const records = inMemoryRecordStore()
    const search = inMemorySearchStore()
    await records.put('indexer:docs:namespace:kb:source:doc-1:chunk:0', {
      namespace: 'kb',
      sourceId: 'doc-1',
      chunkId: '0',
      ordinal: 0,
      content: 'a',
      metadata: {},
    })
    await records.put('indexer:docs:namespace:kb:source:doc-1:chunk:1', {
      namespace: 'kb',
      sourceId: 'doc-1',
      chunkId: '1',
      ordinal: 1,
      content: 'b',
      metadata: {},
    })
    await records.put('indexer:docs:namespace:kb:source:doc-2:chunk:0', {
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
      records,
      search,
    })

    const deleted = await indexer.deleteSource('doc-1')
    expect(deleted).toBe(2)
    expect(await records.get('indexer:docs:namespace:kb:source:doc-1:chunk:0')).toBeNull()
    expect(await records.get('indexer:docs:namespace:kb:source:doc-2:chunk:0')).not.toBeNull()
  })

    it('clear removes all entries for the indexer namespace', async () => {
    const records = inMemoryRecordStore()
    const search = inMemorySearchStore()
    await records.put('indexer:docs:namespace:kb:source:doc-1:chunk:0', {
      namespace: 'kb',
      sourceId: 'doc-1',
      chunkId: '0',
      ordinal: 0,
      content: 'a',
      metadata: {},
    })
    await records.put('indexer:docs:namespace:kb:source:doc-2:chunk:0', {
      namespace: 'kb',
      sourceId: 'doc-2',
      chunkId: '0',
      ordinal: 0,
      content: 'b',
      metadata: {},
    })
    await records.put('indexer:docs:namespace:other:source:doc-3:chunk:0', {
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
      records,
      search,
    })

    const deleted = await indexer.clear()
    expect(deleted).toBe(2)
    expect(await records.get('indexer:docs:namespace:other:source:doc-3:chunk:0')).not.toBeNull()
  })
})

async function listAll(records: RecordStore, prefix: string): Promise<RecordPage> {
  const entries: Array<{ key: string; value: JsonObject }> = []
  let cursor: string | undefined

  while (true) {
    const page = await records.list(prefix, { cursor, limit: 100 })
    entries.push(...page.entries)
    if (!page.cursor) {
      return { entries }
    }
    cursor = page.cursor
  }
}
