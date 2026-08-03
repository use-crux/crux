import { describe, expect, it, vi } from 'vitest'
import { embedding, type NormalizedEmbeddingInput } from '../../src/embedding'
import { indexer } from '../../src/indexing'
import { inMemoryRecordStore, inMemorySearchStore } from '../../src/storage'
import { textOf } from '../embedding/text-input'

describe('indexer embedding-stage cache concurrency', () => {
  it('keeps two identical concurrent runs valid when both compute the same misses', async () => {
    let waiting = 0
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const embed = vi.fn(async (inputs: readonly NormalizedEmbeddingInput[]) => {
      waiting++
      if (waiting === 2) release()
      await gate
      return inputs.map((input) => denseVector(textOf(input)))
    })
    const records = inMemoryRecordStore()
    const storedSearch = inMemorySearchStore()
    const upserted: number[][] = []
    const vectors = {
      ...storedSearch,
      upsert: async (next: Parameters<typeof storedSearch.upsert>[0]) => {
        upserted.push(...next.flatMap((record) => (record.dense ? [[...record.dense]] : [])))
        await storedSearch.upsert(next)
      },
    }
    const docs = cachedDenseIndexer(records, embed, vectors)
    const input = [
      { namespace: 'kb', sourceId: 'source-z', content: 'z' },
      { namespace: 'kb', sourceId: 'source-alpha', content: 'alpha' },
    ]

    const results = await Promise.all([docs.indexDocuments(input), docs.indexDocuments(input)])

    expect(embed).toHaveBeenCalledTimes(2)
    expect(results).toEqual([
      expect.objectContaining({ sourceCount: 2, chunkCount: 2 }),
      expect.objectContaining({ sourceCount: 2, chunkCount: 2 }),
    ])
    expect(upserted.sort(compareVectors)).toEqual([
      [1, 122],
      [1, 122],
      [1, 122],
      [5, 97],
      [5, 97],
      [5, 97],
    ])
    await expect(denseCacheBundles(records)).resolves.toEqual([
      { sourceId: 'source-alpha', vectors: [[5, 97]] },
      { sourceId: 'source-z', vectors: [[1, 122]] },
    ])
  })

  it('never cross-contaminates concurrently cached sources', async () => {
    const records = inMemoryRecordStore()
    const embed = vi.fn(async (inputs: readonly NormalizedEmbeddingInput[]) =>
      inputs.map((input) => denseVector(textOf(input))))
    const docs = cachedDenseIndexer(records, embed)

    await Promise.all([
      docs.indexDocuments([{ namespace: 'kb', sourceId: 'source-alpha', content: 'alpha' }]),
      docs.indexDocuments([{ namespace: 'kb', sourceId: 'source-z', content: 'z' }]),
    ])

    expect(embed).toHaveBeenCalledTimes(2)
    await expect(activeDenseRecords(records)).resolves.toEqual(expectedDenseRecords)
    await expect(denseCacheBundles(records)).resolves.toEqual([
      { sourceId: 'source-alpha', vectors: [[5, 97]] },
      { sourceId: 'source-z', vectors: [[1, 122]] },
    ])
  })

  it('converges to a valid entry when refresh races a readwrite hit', async () => {
    let delayProvider = false
    let release = () => {}
    let signalStarted = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve
    })
    const records = inMemoryRecordStore()
    const embed = vi.fn(async (inputs: readonly NormalizedEmbeddingInput[]) => {
      if (delayProvider) {
        signalStarted()
        await gate
      }
      return inputs.map((input) => denseVector(textOf(input)))
    })
    const docs = cachedDenseIndexer(records, embed)
    const input = [{ namespace: 'kb', sourceId: 'source-alpha', content: 'alpha' }]

    await docs.indexDocuments(input)
    delayProvider = true
    const refreshing = docs.indexDocuments(input, { cache: 'refresh' })
    await started
    const readwrite = await docs.indexDocuments(input)
    release()
    const refreshed = await refreshing

    expect(readwrite.stages?.find((stage) => stage.kind === 'embedding')?.cache).toBe('hit')
    expect(refreshed.stages?.find((stage) => stage.kind === 'embedding')?.cache).toBe('refresh')
    await expect(denseCacheBundles(records)).resolves.toEqual([
      { sourceId: 'source-alpha', vectors: [[5, 97]] },
    ])
  })
})

function cachedDenseIndexer(
  records: ReturnType<typeof inMemoryRecordStore>,
  embed: (inputs: readonly NormalizedEmbeddingInput[]) => Promise<number[][]>,
  search = inMemorySearchStore(),
) {
  return indexer({
    id: 'docs',
    namespace: 'kb',
    records,
    search,
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
}

function denseVector(text: string): number[] {
  return [text.length, text.charCodeAt(0)]
}

function compareVectors(left: number[], right: number[]): number {
  return left[0] - right[0] || left[1] - right[1]
}

async function activeDenseRecords(records: ReturnType<typeof inMemoryRecordStore>) {
  const page = await records.list('indexer:docs:namespace:kb:source:')
  return page.entries
    .map((entry) => entry.value)
    .filter((value) => value.active === true)
    .map((value) => ({ content: value.content, embedding: value.embedding }))
    .sort((left, right) => String(left.content).localeCompare(String(right.content)))
}

async function denseCacheBundles(records: ReturnType<typeof inMemoryRecordStore>) {
  const page = await records.list('indexer:docs:namespace:kb:embedding-cache:')
  return page.entries
    .map((entry) => entry.value)
    .filter((value) => value.kind === 'dense')
    .map((value) => ({ sourceId: value.sourceId, vectors: value.vectors }))
    .sort((left, right) => String(left.sourceId).localeCompare(String(right.sourceId)))
}

const expectedDenseRecords = [
  { content: 'alpha', embedding: [5, 97] },
  { content: 'z', embedding: [1, 122] },
]
