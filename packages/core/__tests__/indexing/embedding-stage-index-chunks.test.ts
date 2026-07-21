import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import { embedding } from '../../src/embedding'
import { indexer, type CruxChunk } from '../../src/indexing'
import { inMemoryRecordStore, inMemoryVectorStore } from '../../src/storage'
import { textOf } from '../embedding/text-input'

const chunks: CruxChunk[] = [
  {
    namespace: 'kb',
    sourceId: 'source-a',
    chunkId: 'chunk-a',
    ordinal: 0,
    content: 'hello',
    metadata: {},
  },
]

describe('indexChunks embedding-stage cache', () => {
  it('supports default, refresh, and bypass cache modes', async () => {
    const embed = vi.fn(async (inputs) => inputs.map((input) => [textOf(input).length, 1]))
    const docs = indexer({
      id: 'docs',
      namespace: 'kb',
      records: inMemoryRecordStore(),
      vectors: inMemoryVectorStore(),
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

    const initial = await docs.indexChunks(chunks)
    const reused = await docs.indexChunks(chunks)
    const refreshed = await docs.indexChunks(chunks, { cache: 'refresh' })
    const reusedAfterRefresh = await docs.indexChunks(chunks)
    const bypassed = await docs.indexChunks(chunks, { cache: 'bypass' })
    const reusedAfterBypass = await docs.indexChunks(chunks)

    expect(embed).toHaveBeenCalledTimes(3)
    expect(cacheOutcome(initial)).toBe('miss')
    expect(cacheOutcome(reused)).toBe('hit')
    expect(cacheOutcome(refreshed)).toBe('refresh')
    expect(cacheOutcome(reusedAfterRefresh)).toBe('hit')
    expect(cacheOutcome(bypassed)).toBe('bypass')
    expect(cacheOutcome(reusedAfterBypass)).toBe('hit')
  })

  it('preserves dry-run overload narrowing when a cache mode is provided', async () => {
    const docs = indexer({
      id: 'docs',
      namespace: 'kb',
      records: inMemoryRecordStore(),
      dense: embedding({
        kind: 'dense',
        name: 'dense-test',
        dimensions: 2,
        maxInputTokens: 100,
        batch: { maxSize: 8 },
        version: 'v1',
        embed: async (inputs) => inputs.map((input) => [textOf(input).length, 1]),
      }),
      cache: true,
    })

    const result = await docs.indexChunks(chunks, { dryRun: true, cache: 'readwrite' })

    expectTypeOf(result.dryRun).toEqualTypeOf<true>()
    expect(result).toMatchObject({ dryRun: true, embeddings: { dense: true, sparse: false } })
  })
})

function cacheOutcome(result: Awaited<ReturnType<ReturnType<typeof indexer>['indexChunks']>>) {
  return result.stages?.find((stage) => stage.kind === 'embedding')?.cache
}
