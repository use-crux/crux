import { describe, expect, it, vi } from 'vitest'
import { embedding } from '../../embedding'
import { corpus, indexer, indexingPipeline, transform } from '../../indexing'
import { inMemoryCruxStore, inMemoryDataStore, inMemoryVectorStore } from '../../store/memory'

describe('corpus', () => {
  function setup() {
    const store = inMemoryCruxStore()
    const embed = vi.fn(async (texts: string[]) => texts.map((text) => [text.length, 1]))
    const dense = embedding({
      kind: 'dense',
      name: 'dense-test',
      dimensions: 2,
      maxInputTokens: 100,
      batch: { maxSize: 8 },
      embed,
    })
    const docsIndexer = indexer({
      id: 'docs',
      namespace: 'kb',
      store,
      dense,
    })
    const docs = corpus({
      id: 'docs',
      namespace: 'kb',
      store,
      indexer: docsIndexer,
    })

    return { store, docs, embed }
  }

  it('syncs a new source and writes a source record', async () => {
    const { docs } = setup()

    const result = await docs.sync([
      {
        namespace: 'kb',
        sourceId: 'intro',
        title: 'Intro',
        content: 'Hello corpus',
        metadata: { section: 'start' },
      },
    ])

    expect(result).toMatchObject({
      corpusId: 'docs',
      namespace: 'kb',
      added: 1,
      changed: 0,
      unchanged: 0,
      failed: 0,
      chunkCount: 1,
    })

    const source = await docs.getSource('intro')
    expect(source).toMatchObject({
      _tag: 'SourceRecord',
      corpusId: 'docs',
      namespace: 'kb',
      sourceId: 'intro',
      status: 'indexed',
      chunkCount: 1,
      title: 'Intro',
      metadata: { section: 'start' },
    })
    expect(source?.contentHash).toEqual(expect.any(String))
    expect(source?.metadataHash).toEqual(expect.any(String))
    expect(source?.sourceHash).toEqual(expect.any(String))
    expect(source?.indexHash).toEqual(expect.any(String))
    expect(source?.indexedAt).toEqual(expect.any(Number))
  })

  it('accepts explicit DataStore and VectorStore capabilities', async () => {
    const data = inMemoryDataStore()
    const vectors = inMemoryVectorStore()
    const dense = embedding({
      kind: 'dense',
      name: 'dense-test',
      dimensions: 2,
      maxInputTokens: 100,
      batch: { maxSize: 8 },
      embed: async (texts) => texts.map((text) => [text.length, 1]),
    })
    const docsIndexer = indexer({
      id: 'docs',
      namespace: 'kb',
      data,
      vectors,
      dense,
    })
    const docs = corpus({ id: 'docs', namespace: 'kb', data, indexer: docsIndexer })

    await docs.sync([{ namespace: 'kb', sourceId: 'intro', content: 'Hello corpus' }])

    expect(await docs.getSource('intro')).toMatchObject({ sourceId: 'intro', status: 'indexed' })
  })

  it('records the indexing pipeline stages on source records', async () => {
    const store = inMemoryCruxStore()
    const docsIndexer = indexer({
      id: 'docs',
      namespace: 'kb',
      store,
      cache: true,
      pipeline: indexingPipeline({
        documents: [
          transform.document({
            name: 'normalize',
            version: '1',
            run(document) {
              return { ...document, content: document.content.trim() }
            },
          }),
        ],
      }),
    })
    const docs = corpus({ id: 'docs', namespace: 'kb', store, indexer: docsIndexer })

    await docs.sync([{ namespace: 'kb', sourceId: 'intro', content: '  Hello pipeline  ' }])

    const source = await docs.getSource('intro')
    expect(source?.stages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'normalize',
          kind: 'document-transform',
          status: 'success',
          cache: 'miss',
          inputHash: expect.any(String),
          outputHash: expect.any(String),
        }),
        expect.objectContaining({
          name: 'structured',
          kind: 'chunker',
          status: 'success',
          cache: 'miss',
          chunkCount: 1,
          parentCount: 0,
        }),
      ]),
    )
  })

  it('skips unchanged sources and reindexes changed sources', async () => {
    const { docs } = setup()
    await docs.sync([{ namespace: 'kb', sourceId: 'intro', content: 'Hello corpus' }])

    const unchanged = await docs.sync([{ namespace: 'kb', sourceId: 'intro', content: 'Hello corpus' }])
    expect(unchanged.unchanged).toBe(1)
    expect(unchanged.sources[0]).toMatchObject({ sourceId: 'intro', action: 'unchanged' })

    const changed = await docs.sync([{ namespace: 'kb', sourceId: 'intro', content: 'Updated corpus' }])
    expect(changed.changed).toBe(1)
    expect(changed.sources[0]).toMatchObject({ sourceId: 'intro', action: 'changed', reason: 'contentChanged' })
  })

  it('ignores excluded volatile metadata when hashing sources', async () => {
    const store = inMemoryCruxStore()
    const docsIndexer = indexer({ id: 'docs', namespace: 'kb', store })
    const docs = corpus({
      id: 'docs',
      namespace: 'kb',
      store,
      indexer: docsIndexer,
      hash: { excludeMetadata: ['mtimeMs'] },
    })

    await docs.sync([{ namespace: 'kb', sourceId: 'intro', content: 'Hello', metadata: { mtimeMs: 1 } }])
    const result = await docs.sync([{ namespace: 'kb', sourceId: 'intro', content: 'Hello', metadata: { mtimeMs: 2 } }])

    expect(result.unchanged).toBe(1)
  })

  it('skips changed existing sources in append-only mode', async () => {
    const { docs } = setup()
    await docs.sync([{ namespace: 'kb', sourceId: 'intro', content: 'Hello corpus' }])

    const result = await docs.sync([{ namespace: 'kb', sourceId: 'intro', content: 'Updated corpus' }], {
      mode: 'appendOnly',
    })

    expect(result.changed).toBe(1)
    expect(result.skipped).toBe(1)
    expect(result.sources[0]).toMatchObject({ action: 'skipped', reason: 'appendOnly' })
  })

  it('requires a complete source set before deleting stale sources', async () => {
    const { docs } = setup()
    await docs.sync([{ namespace: 'kb', sourceId: 'intro', content: 'Hello corpus' }])

    await expect(docs.sync([], { stale: 'delete' })).rejects.toThrow(/sourceSet: 'complete'/)
  })

  it('deletes stale sources only for complete source sets', async () => {
    const { docs, store } = setup()
    await docs.sync([{ namespace: 'kb', sourceId: 'intro', content: 'Hello corpus' }])

    const result = await docs.sync([], { stale: 'delete', sourceSet: 'complete' })

    expect(result.stale).toBe(1)
    expect(result.deleted).toBe(1)
    expect(result.sources[0]).toMatchObject({ sourceId: 'intro', action: 'deleted', reason: 'stale' })
    expect(await docs.getSource('intro')).toMatchObject({ status: 'deleted' })
    expect((await store.list('indexer:docs:namespace:kb:source:intro:')).entries).toHaveLength(0)
  })

  it('dry-runs a full sync simulation without writing chunks or ledger records', async () => {
    const { docs, store, embed } = setup()

    const result = await docs.sync([{ namespace: 'kb', sourceId: 'intro', content: 'Hello corpus' }], {
      dryRun: true,
    })

    expect(result.dryRun).toBe(true)
    expect(result.added).toBe(1)
    expect(result.chunkCount).toBe(1)
    expect(embed).toHaveBeenCalledTimes(1)
    expect(await docs.getSource('intro')).toBeNull()
    expect((await store.list('indexer:docs:namespace:kb:source:intro:')).entries).toHaveLength(0)
  })

  it('records failed sources while continuing the sync', async () => {
    const store = inMemoryCruxStore()
    const docsIndexer = indexer({
      id: 'docs',
      namespace: 'kb',
      store,
      pipeline: indexingPipeline({
        documents: [
          transform.document({
            name: 'reject-bad',
            version: '1',
            run(document) {
              if (document.sourceId === 'bad') throw new Error('bad document')
              return document
            },
          }),
        ],
      }),
    })
    const docs = corpus({ id: 'docs', namespace: 'kb', store, indexer: docsIndexer })

    const result = await docs.sync([
      { namespace: 'kb', sourceId: 'bad', content: 'Bad' },
      { namespace: 'kb', sourceId: 'good', content: 'Good' },
    ])

    expect(result.failed).toBe(1)
    expect(result.added).toBe(1)
    expect(await docs.getSource('bad')).toMatchObject({ status: 'failed' })
    expect(await docs.getSource('good')).toMatchObject({ status: 'indexed' })
  })

  it('records failed ingest load results while continuing the sync', async () => {
    const { docs } = setup()

    const result = await docs.sync([
      {
        ok: false,
        namespace: 'kb',
        sourceId: 'bad-json',
        error: { code: 'parse_failed', message: 'Invalid JSON', parser: 'json' },
        metadata: { sourcePath: '/docs/bad.json' },
      },
      {
        ok: true,
        document: {
          namespace: 'kb',
          sourceId: 'good',
          content: 'Good source',
          parts: [{ id: 'text:1', kind: 'text', content: 'Good source' }],
        },
      },
    ])

    expect(result.failed).toBe(1)
    expect(result.added).toBe(1)
    expect(result.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceId: 'bad-json', action: 'failed', reason: 'error' }),
        expect.objectContaining({ sourceId: 'good', action: 'added' }),
      ]),
    )
    expect(await docs.getSource('bad-json')).toMatchObject({
      status: 'failed',
      metadata: { sourcePath: '/docs/bad.json' },
      lastError: { message: 'Invalid JSON' },
    })
  })
})
