import { describe, expect, it, vi } from 'vitest'
import type { AssetStore } from '../../src/asset'
import { inMemoryAssetStore } from '../../src/asset'
import { embedding, embeddingSpaceDigest } from '../../src/embedding'
import { indexer, indexingPipeline, transform } from '../../src/indexing'
import { inMemoryRecordStore, inMemoryVectorStore } from '../../src/storage'

describe('multimodal indexing storage', () => {
  it('materializes before embedding, bypasses pipeline caches, and persists no media payload', async () => {
    const events: string[] = []
    const assetStore = inMemoryAssetStore()
    const assets: AssetStore = {
      put: vi.fn(async (...args) => {
        events.push('put')
        return assetStore.put(...args)
      }),
      get: assetStore.get,
      delete: assetStore.delete,
    }
    const records = inMemoryRecordStore()
    const vectors = inMemoryVectorStore()
    const runTransform = vi.fn((document) => document)
    const runProvider = vi.fn(async (inputs) => {
      events.push('embed')
      return inputs.map(() => [1, 0])
    })
    const dense = embedding({
      kind: 'dense',
      name: 'multimodal-test',
      dimensions: 2,
      maxInputTokens: 100,
      modalities: ['text', 'image'],
      version: 'v1',
      batch: { maxSize: 8 },
      embed: runProvider,
    })
    const docs = indexer({
      id: 'products',
      namespace: 'products',
      storage: { records, vectors, assets },
      dense,
      cache: true,
      pipeline: indexingPipeline({
        documents: [transform.document({ name: 'identity', version: '1', run: runTransform })],
      }),
    })
    const input = [{
      namespace: 'products',
      sourceId: 'rex',
      asset: {
        type: 'data' as const,
        data: new Uint8Array([82, 69, 88]),
        mediaType: 'image/png',
        filename: 'private-dog.png',
      },
    }]

    await docs.indexDocuments(input)
    const second = await docs.indexDocuments(input)

    expect(events.slice(0, 2)).toEqual(['put', 'embed'])
    expect(assets.put).toHaveBeenCalledTimes(2)
    expect(runProvider).toHaveBeenCalledOnce()
    expect(runTransform).toHaveBeenCalledTimes(2)
    expect(second.stages?.find((stage) => stage.kind === 'embedding')?.cache).toBe('hit')

    const [entry] = (await records.list('indexer:products:namespace:products:source:rex:')).entries
    const serialized = JSON.stringify(entry.value)
    expect(serialized).not.toMatch(/"media"|private-dog\.png|"data"|82,69,88|fileId/)
    expect(entry.value.source).toMatchObject({
      assetRef: { uri: expect.stringMatching(/^memory:\/\/asset\//) },
      mediaType: 'image/png',
    })
    const stored = await assets.get((entry.value.source as { assetRef: { uri: string } }).assetRef)
    expect([...((stored as { data: Uint8Array }).data)]).toEqual([82, 69, 88])

    const digest = embeddingSpaceDigest(dense.space.fingerprint)
    await expect(records.get('indexer-namespace:products:embedding-space')).resolves.toMatchObject({
      digest,
      name: 'multimodal-test',
      dimensions: 2,
      modalities: ['text', 'image'],
      writers: ['products'],
    })
    const [hit] = await vectors.search({ mode: 'dense', dense: [1, 0], limit: 1 })
    expect(hit.metadata?.embeddingSpace).toBe(digest)
  })

  it('respects caller attribution and emits one no-store warning per source', async () => {
    const put = vi.fn()
    const seenWarnings: unknown[] = []
    const records = inMemoryRecordStore()
    const docs = indexer({
      id: 'media',
      namespace: 'kb',
      storage: {
        records,
        assets: { put, get: vi.fn(), delete: vi.fn() },
      },
      pipeline: indexingPipeline({
        documents: [transform.document({
          name: 'capture-warnings',
          version: '1',
          run(document) {
            seenWarnings.push(document.warnings)
            return document
          },
        })],
      }),
    })

    await docs.indexDocuments([{
      namespace: 'kb',
      sourceId: 'owned',
      source: { assetRef: { uri: 'asset://caller-owned' } },
      asset: { type: 'data', data: new Uint8Array([1]), mediaType: 'image/png' },
    }])

    expect(put).not.toHaveBeenCalled()
    const [owned] = (await records.list('indexer:media:namespace:kb:source:owned:')).entries
    expect(owned.value.source).toMatchObject({ assetRef: { uri: 'asset://caller-owned' } })

    const noStoreWarnings: unknown[] = []
    const noStore = indexer({
      id: 'unattributed',
      namespace: 'kb',
      records: inMemoryRecordStore(),
      pipeline: indexingPipeline({
        documents: [transform.document({
          name: 'capture-warnings',
          version: '1',
          run(document) {
            noStoreWarnings.push(document.warnings)
            return document
          },
        })],
      }),
    })
    await noStore.indexDocuments([{
      namespace: 'kb',
      sourceId: 'loose',
      parts: [
        { id: 'one', kind: 'media', asset: { type: 'data', data: new Uint8Array([1]), mediaType: 'image/png' } },
        { id: 'two', kind: 'media', asset: { type: 'data', data: new Uint8Array([2]), mediaType: 'image/png' } },
      ],
    }])

    expect(seenWarnings[0]).toBeUndefined()
    expect(noStoreWarnings[0]).toEqual([
      expect.objectContaining({ code: 'media-unattributed' }),
    ])
  })

  it('keeps dry-runs free of asset, record, vector, and cache writes', async () => {
    const records = inMemoryRecordStore()
    const vectorBase = inMemoryVectorStore()
    const upsert = vi.fn(vectorBase.upsert.bind(vectorBase))
    const put = vi.fn()
    const dense = embedding({
      kind: 'dense', name: 'media', dimensions: 2, maxInputTokens: 100,
      modalities: ['image'], batch: { maxSize: 8 }, embed: async () => [[1, 0]],
    })
    const docs = indexer({
      id: 'dry', namespace: 'kb', dense, cache: true,
      storage: {
        records,
        vectors: { ...vectorBase, upsert },
        assets: { put, get: vi.fn(), delete: vi.fn() },
      },
    })

    const result = await docs.indexDocuments([{
      namespace: 'kb', sourceId: 'photo',
      asset: { type: 'data', data: new Uint8Array([1, 2]), mediaType: 'image/png' },
    }], { dryRun: true })

    expect(result.dryRun).toBe(true)
    expect(result.chunks[0].source?.assetRef).toBeUndefined()
    expect(put).not.toHaveBeenCalled()
    expect(upsert).not.toHaveBeenCalled()
    expect((await records.list('indexer:dry:namespace:kb:')).entries).toEqual([])
  })

  it('fails before provider execution when asset materialization fails', async () => {
    const provider = vi.fn(async () => [[1, 0]])
    const records = inMemoryRecordStore()
    const docs = indexer({
      id: 'failed-put', namespace: 'kb',
      storage: {
        records,
        vectors: inMemoryVectorStore(),
        assets: {
          put: vi.fn(async () => { throw new Error('asset backend unavailable') }),
          get: vi.fn(),
          delete: vi.fn(),
        },
      },
      dense: embedding({
        kind: 'dense', name: 'media', dimensions: 2, maxInputTokens: 100,
        modalities: ['image'], batch: { maxSize: 8 }, embed: provider,
      }),
    })

    await expect(docs.indexDocuments([{
      namespace: 'kb', sourceId: 'photo',
      asset: { type: 'data', data: new Uint8Array([1]), mediaType: 'image/png' },
    }])).rejects.toThrow('asset backend unavailable')

    expect(provider).not.toHaveBeenCalled()
    expect((await records.list('indexer:failed-put:namespace:kb:source:')).entries).toEqual([])
  })

  it('does not cache media introduced by a document transform', async () => {
    const records = inMemoryRecordStore()
    const introduceMedia = vi.fn((document) => ({
      ...document,
      content: undefined,
      parts: [{
        id: 'generated-media',
        kind: 'media' as const,
        asset: { type: 'data' as const, data: new Uint8Array([7, 8]), mediaType: 'image/png' },
      }],
    }))
    const docs = indexer({
      id: 'introduced', namespace: 'kb', records, cache: true,
      pipeline: indexingPipeline({
        documents: [transform.document({ name: 'introduce-media', version: '1', run: introduceMedia })],
      }),
    })
    const input = [{ namespace: 'kb', sourceId: 'generated', content: 'replace me' }]

    await docs.indexDocuments(input)
    await docs.indexDocuments(input)

    expect(introduceMedia).toHaveBeenCalledTimes(2)
    expect((await records.list('indexer:introduced:namespace:kb:pipeline-cache:')).entries).toEqual([])
  })
})
