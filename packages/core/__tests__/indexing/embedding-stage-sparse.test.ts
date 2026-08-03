import { describe, expect, it, vi } from 'vitest'
import { embedding } from '../../src/embedding'
import { indexer } from '../../src/indexing'
import { inMemoryRecordStore, inMemorySearchStore } from '../../src/storage'
import { textOf } from '../embedding/text-input'

describe('indexer sparse embedding-stage cache', () => {
  it('reuses sparse vectors as validated source bundles', async () => {
    const embed = vi.fn(async (texts: string[]) =>
      texts.map((text) => ({ indices: [0], values: [text.length] })),
    )
    const docs = indexer({
      id: 'docs',
      namespace: 'kb',
      records: inMemoryRecordStore(),
      search: inMemorySearchStore(),
      sparse: embedding({
        kind: 'sparse',
        name: 'sparse-test',
        maxInputTokens: 100,
        batch: { maxSize: 8 },
        version: 'v1',
        embed,
      }),
      cache: true,
    })
    const input = [{ namespace: 'kb', sourceId: 'source-a', content: 'hello' }]

    const first = await docs.indexDocuments(input)
    const second = await docs.indexDocuments(input)

    expect(embed).toHaveBeenCalledOnce()
    expect(first.stages?.find((stage) => stage.kind === 'embedding')).toMatchObject({
      embeddingKind: 'sparse',
      cache: 'miss',
    })
    expect(second.stages?.find((stage) => stage.kind === 'embedding')).toMatchObject({
      embeddingKind: 'sparse',
      cache: 'hit',
    })
  })

  it('rejects malformed fresh sparse output before cache or generation writes', async () => {
    const records = inMemoryRecordStore()
    const docs = indexer({
      id: 'docs',
      namespace: 'kb',
      records,
      search: inMemorySearchStore(),
      sparse: embedding({
        kind: 'sparse',
        name: 'sparse-test',
        maxInputTokens: 100,
        batch: { maxSize: 8 },
        version: 'v1',
        embed: async (texts) =>
          texts.map(() => ({ indices: [0, 1], values: [1] })),
      }),
      cache: true,
    })

    await expect(
      docs.indexDocuments([{ namespace: 'kb', sourceId: 'source-a', content: 'hello' }]),
    ).rejects.toThrow('Sparse embedding output does not match the expected count and shape.')
    await expect(records.list('indexer:docs:namespace:kb:embedding-cache:')).resolves.toMatchObject({
      entries: [],
    })
    await expect(records.list('indexer:docs:namespace:kb:source:source-a:')).resolves.toMatchObject({
      entries: [],
    })
  })

  it('preserves hybrid ordering when sparse changes and rejects a dense space change', async () => {
    const records = inMemoryRecordStore()
    const search = inMemorySearchStore()
    const input = [
      { namespace: 'kb', sourceId: 'source-z', content: 'z' },
      { namespace: 'kb', sourceId: 'source-alpha', content: 'alpha' },
    ]
    const denseV1 = denseEmbedding('dense-v1')
    const sparseV1 = sparseEmbedding('sparse-v1')

    await indexer({
      id: 'docs',
      namespace: 'kb',
      records,
      search,
      dense: denseV1.value,
      sparse: sparseV1.value,
      cache: true,
    }).indexDocuments(input)

    const sparseV2 = sparseEmbedding('sparse-v2')
    const denseHit = await indexer({
      id: 'docs',
      namespace: 'kb',
      records,
      search,
      dense: denseV1.value,
      sparse: sparseV2.value,
      cache: true,
    }).indexDocuments(input)

    expect(denseV1.embed).toHaveBeenCalledOnce()
    expect(sparseV1.embed).toHaveBeenCalledOnce()
    expect(sparseV2.embed).toHaveBeenCalledOnce()
    expect(embeddingOutcomes(denseHit)).toEqual([
      ['dense', 'hit'],
      ['dense', 'hit'],
      ['sparse', 'miss'],
      ['sparse', 'miss'],
    ])
    await expect(activeHybridRecords(records)).resolves.toEqual(expectedHybridRecords)

    const denseV2 = denseEmbedding('dense-v2')
    const denseMismatch = indexer({
      id: 'docs',
      namespace: 'kb',
      records,
      search,
      dense: denseV2.value,
      sparse: sparseV2.value,
      cache: true,
    }).indexDocuments(input)

    await expect(denseMismatch).rejects.toThrow('Embedding space mismatch')
    expect(denseV2.embed).not.toHaveBeenCalled()
    expect(sparseV2.embed).toHaveBeenCalledOnce()
    await expect(activeHybridRecords(records)).resolves.toEqual(expectedHybridRecords)

    const cacheEntries = await records.list('indexer:docs:namespace:kb:embedding-cache:')
    expect(cacheEntries.entries.map((entry) => entry.value.kind).sort()).toEqual([
      'dense',
      'dense',
      'sparse',
      'sparse',
      'sparse',
      'sparse',
    ])
    expect(new Set(cacheEntries.entries.map((entry) => entry.key)).size).toBe(6)
  })
})

function denseEmbedding(version: string) {
  const embed = vi.fn(async (inputs) =>
    inputs.map((input) => [textOf(input).length, textOf(input).charCodeAt(0)]),
  )
  return {
    embed,
    value: embedding({
      kind: 'dense',
      name: 'dense-test',
      dimensions: 2,
      maxInputTokens: 100,
      batch: { maxSize: 8 },
      version,
      embed,
    }),
  }
}

function sparseEmbedding(version: string) {
  const embed = vi.fn(async (texts: string[]) =>
    texts.map((text) => ({ indices: [text.length], values: [text.charCodeAt(0)] })),
  )
  return {
    embed,
    value: embedding({
      kind: 'sparse',
      name: 'sparse-test',
      maxInputTokens: 100,
      batch: { maxSize: 8 },
      version,
      embed,
    }),
  }
}

function embeddingOutcomes(result: Awaited<ReturnType<ReturnType<typeof indexer>['indexDocuments']>>) {
  return result.stages
    ?.filter((stage) => stage.kind === 'embedding')
    .map((stage) => [stage.embeddingKind, stage.cache])
}

async function activeHybridRecords(records: ReturnType<typeof inMemoryRecordStore>) {
  const page = await records.list('indexer:docs:namespace:kb:source:')
  return page.entries
    .map((entry) => entry.value)
    .filter((value) => value.active === true)
    .map((value) => ({
      content: value.content,
      embedding: value.embedding,
      sparseEmbedding: value.sparseEmbedding,
    }))
    .sort((left, right) => String(left.content).localeCompare(String(right.content)))
}

const expectedHybridRecords = [
  {
    content: 'alpha',
    embedding: [5, 97],
    sparseEmbedding: { indices: [5], values: [97] },
  },
  {
    content: 'z',
    embedding: [1, 122],
    sparseEmbedding: { indices: [1], values: [122] },
  },
]
