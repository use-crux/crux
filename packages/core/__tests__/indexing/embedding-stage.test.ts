import { describe, expect, it, vi } from 'vitest'
import { embedding } from '../../src/embedding'
import { indexer, indexingPipeline, transform } from '../../src/indexing'
import { inMemoryRecordStore, inMemorySearchStore } from '../../src/storage'
import { textOf } from '../embedding/text-input'
import { schema2TextDocument } from '../fixtures/schema2-stored-evidence'

function documents(input: Parameters<typeof schema2TextDocument>[0][]) {
  return input.map(schema2TextDocument)
}

describe('indexer embedding-stage cache', () => {
  it('reuses dense vectors while still completing each indexing generation', async () => {
    const embed = vi.fn(async (inputs) => inputs.map((input) => [textOf(input).length, 1]))
    const records = inMemoryRecordStore()
    const dense = embedding({
      kind: 'dense',
      name: 'dense-test',
      dimensions: 2,
      maxInputTokens: 100,
      batch: { maxSize: 8 },
      version: 'v1',
      embed,
    })
    const docs = indexer({
      id: 'docs',
      namespace: 'kb',
      records,
      search: inMemorySearchStore(),
      dense,
      cache: true,
    })
    const input = documents([{ namespace: 'kb', sourceId: 'source-a', content: 'hello' }])

    const first = await docs.indexDocuments(input)
    const [firstGeneration] = (await records.list('indexer:docs:namespace:kb:source:source-a:')).entries
    const second = await docs.indexDocuments(input)
    const [secondGeneration] = (await records.list('indexer:docs:namespace:kb:source:source-a:')).entries

    expect(embed).toHaveBeenCalledOnce()
    expect(first).toMatchObject({ namespace: 'kb', sourceCount: 1, chunkCount: 1 })
    expect(second).toMatchObject({ namespace: 'kb', sourceCount: 1, chunkCount: 1 })
    expect(firstGeneration?.value).toMatchObject({ active: true })
    expect(secondGeneration?.value).toMatchObject({ active: true })
    expect(secondGeneration?.value.generationId).not.toBe(firstGeneration?.value.generationId)
  })

  it('reports dense embedding misses and hits per source', async () => {
    const dense = embedding({
      kind: 'dense',
      name: 'dense-test',
      dimensions: 2,
      maxInputTokens: 100,
      batch: { maxSize: 8 },
      version: 'v1',
      embed: async (inputs) => inputs.map((input) => [textOf(input).length, 1]),
    })
    const docs = indexer({
      id: 'docs',
      namespace: 'kb',
      records: inMemoryRecordStore(),
      search: inMemorySearchStore(),
      dense,
      cache: true,
    })
    const input = documents([{ namespace: 'kb', sourceId: 'source-a', content: 'hello' }])

    const first = await docs.indexDocuments(input)
    const second = await docs.indexDocuments(input)

    expect(first.stages?.find((stage) => stage.kind === 'embedding')).toMatchObject({
      name: 'dense-test',
      kind: 'embedding',
      embeddingKind: 'dense',
      cache: 'miss',
      status: 'success',
      chunkCount: 1,
    })
    expect(second.stages?.find((stage) => stage.kind === 'embedding')).toMatchObject({
      embeddingKind: 'dense',
      cache: 'hit',
    })
  })

  it('invalidates only changed sources and batches all misses once', async () => {
    const embed = vi.fn(async (inputs) => inputs.map((input) => [textOf(input).length, 1]))
    const docs = indexer({
      id: 'docs',
      namespace: 'kb',
      records: inMemoryRecordStore(),
      search: inMemorySearchStore(),
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

    await docs.indexDocuments(documents([
      { namespace: 'kb', sourceId: 'source-a', content: 'alpha' },
      { namespace: 'kb', sourceId: 'source-b', content: 'beta' },
    ]))
    const second = await docs.indexDocuments(documents([
      { namespace: 'kb', sourceId: 'source-a', content: 'alpha changed' },
      { namespace: 'kb', sourceId: 'source-b', content: 'beta' },
    ]))

    expect(embed).toHaveBeenCalledTimes(2)
    expect(embed).toHaveBeenNthCalledWith(1, [
      { type: 'text', text: 'alpha' },
      { type: 'text', text: 'beta' },
    ], { role: 'document' })
    expect(embed).toHaveBeenNthCalledWith(2, [
      { type: 'text', text: 'alpha changed' },
    ], { role: 'document' })
    expect(second.stages?.filter((stage) => stage.kind === 'embedding').map((stage) => stage.cache)).toEqual([
      'miss',
      'hit',
    ])
  })

  it('honors refresh and bypass without poisoning reusable entries', async () => {
    const embed = vi.fn(async (inputs) => inputs.map((input) => [textOf(input).length, 1]))
    const docs = indexer({
      id: 'docs',
      namespace: 'kb',
      records: inMemoryRecordStore(),
      search: inMemorySearchStore(),
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
    const input = documents([{ namespace: 'kb', sourceId: 'source-a', content: 'hello' }])

    const initial = await docs.indexDocuments(input)
    const refreshed = await docs.indexDocuments(input, { cache: 'refresh' })
    const reused = await docs.indexDocuments(input)
    const bypassed = await docs.indexDocuments(input, { cache: 'bypass' })
    const reusedAgain = await docs.indexDocuments(input)

    expect(embed).toHaveBeenCalledTimes(3)
    expect(initial.stages?.find((stage) => stage.kind === 'embedding')?.cache).toBe('miss')
    expect(refreshed.stages?.find((stage) => stage.kind === 'embedding')?.cache).toBe('refresh')
    expect(reused.stages?.find((stage) => stage.kind === 'embedding')?.cache).toBe('hit')
    expect(bypassed.stages?.find((stage) => stage.kind === 'embedding')?.cache).toBe('bypass')
    expect(reusedAgain.stages?.find((stage) => stage.kind === 'embedding')?.cache).toBe('hit')
  })

  it('does not read, write, or report embedding cache state when caching is disabled', async () => {
    const embed = vi.fn(async (inputs) => inputs.map((input) => [textOf(input).length, 1]))
    const docs = indexer({
      id: 'docs',
      namespace: 'kb',
      records: inMemoryRecordStore(),
      search: inMemorySearchStore(),
      dense: embedding({
        kind: 'dense',
        name: 'dense-test',
        dimensions: 2,
        maxInputTokens: 100,
        batch: { maxSize: 8 },
        version: 'v1',
        embed,
      }),
      cache: false,
    })
    const input = documents([{ namespace: 'kb', sourceId: 'source-a', content: 'hello' }])

    const first = await docs.indexDocuments(input)
    const second = await docs.indexDocuments(input)

    expect(embed).toHaveBeenCalledTimes(2)
    expect(first.stages?.find((stage) => stage.kind === 'embedding')?.cache).toBeUndefined()
    expect(second.stages?.find((stage) => stage.kind === 'embedding')?.cache).toBeUndefined()
  })

  it('does not let a dry run populate the embedding-stage cache', async () => {
    const embed = vi.fn(async (inputs) => inputs.map((input) => [textOf(input).length, 1]))
    const docs = indexer({
      id: 'docs',
      namespace: 'kb',
      records: inMemoryRecordStore(),
      search: inMemorySearchStore(),
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
    const input = documents([{ namespace: 'kb', sourceId: 'source-a', content: 'hello' }])

    const dryRun = await docs.indexDocuments(input, { dryRun: true })
    const realRun = await docs.indexDocuments(input)

    expect(embed).toHaveBeenCalledTimes(2)
    expect(dryRun.stages?.find((stage) => stage.kind === 'embedding')?.cache).toBe('miss')
    expect(realRun.stages?.find((stage) => stage.kind === 'embedding')?.cache).toBe('miss')
  })

  it('does not let a text dry run populate pre-embedding pipeline caches', async () => {
    const records = inMemoryRecordStore()
    const docs = indexer({
      id: 'docs', namespace: 'kb', records, cache: true,
      pipeline: indexingPipeline({
        documents: [transform.document({
          name: 'identity', version: '1', run: (document) => document,
        })],
      }),
    })

    await docs.indexDocuments(documents([{ namespace: 'kb', sourceId: 'source-a', content: 'hello' }]), { dryRun: true })

    expect((await records.list('indexer:docs:namespace:kb:pipeline-cache:')).entries).toEqual([])
  })
})
