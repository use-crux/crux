import { describe, expect, it, vi } from 'vitest'
import { EmbeddingModalityError, EmbeddingSpaceMismatchError, embedding } from '../../src/embedding'
import { indexer } from '../../src/indexing'
import { inMemoryRecordStore, inMemorySearchStore } from '../../src/storage'
import { schema2MediaDocument, schema2TextDocument } from '../fixtures/schema2-stored-evidence'

describe('multimodal indexing embedding stage', () => {
  it('embeds media densely as documents and omits media from the sparse leg', async () => {
    const records = inMemoryRecordStore()
    const denseProvider = vi.fn(async (inputs) => inputs.map((input) => (input.type === 'image' ? [1, 0] : [0, 1])))
    const sparseProvider = vi.fn(async (texts: string[]) => texts.map(() => ({ indices: [0], values: [1] })))
    const docs = indexer({
      id: 'hybrid',
      namespace: 'kb',
      records,
      search: inMemorySearchStore(),
      dense: embedding({
        kind: 'dense',
        name: 'multimodal',
        dimensions: 2,
        maxInputTokens: 100,
        modalities: ['text', 'image'],
        batch: { maxSize: 8 },
        embed: denseProvider,
      }),
      sparse: embedding({
        kind: 'sparse',
        name: 'sparse',
        maxInputTokens: 100,
        batch: { maxSize: 8 },
        embed: sparseProvider,
      }),
    })

    await docs.indexDocuments([
      schema2MediaDocument({
        namespace: 'kb',
        sourceId: 'rex',
        content: 'Rex is a brown dog.',
        asset: { type: 'data', data: new Uint8Array([1, 2, 3]), mediaType: 'image/png' },
      }),
    ])

    expect(denseProvider).toHaveBeenCalledWith(
      [
        { type: 'text', text: 'Rex is a brown dog.' },
        expect.objectContaining({
          type: 'image',
          asset: expect.objectContaining({ type: 'data', mediaType: 'image/png' }),
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      ],
      { role: 'document' },
    )
    expect(sparseProvider).toHaveBeenCalledWith(['Rex is a brown dog.'])

    const entries = (await records.list('indexer:hybrid:namespace:kb:source:rex:')).entries.map((entry) => entry.value)
    expect(entries).toHaveLength(2)
    expect(entries.find((entry) => entry.content === '')?.sparseEmbedding).toBeUndefined()
    expect(entries.find((entry) => entry.content === 'Rex is a brown dog.')?.sparseEmbedding).toEqual({
      indices: [0],
      values: [1],
    })
  })

  it('rejects unsupported media before provider I/O and names every offending source', async () => {
    const provider = vi.fn(async () => [[1, 0]])
    const docs = indexer({
      id: 'text-only',
      namespace: 'kb',
      records: inMemoryRecordStore(),
      search: inMemorySearchStore(),
      dense: embedding({
        kind: 'dense',
        name: 'text-only',
        dimensions: 2,
        maxInputTokens: 100,
        batch: { maxSize: 8 },
        embed: provider,
      }),
    })

    const run = docs.indexDocuments([
      {
        namespace: 'kb',
        sourceId: 'photo-a',
        asset: { type: 'data', data: new Uint8Array([1]), mediaType: 'image/png' },
      },
      {
        namespace: 'kb',
        sourceId: 'photo-b',
        asset: { type: 'data', data: new Uint8Array([2]), mediaType: 'image/png' },
      },
    ])

    await expect(run).rejects.toBeInstanceOf(EmbeddingModalityError)
    await expect(run).rejects.toThrow(/photo-a, photo-b/)
    expect(provider).not.toHaveBeenCalled()
  })

  it('computes but never caches media without a locally provable byte hash', async () => {
    const records = inMemoryRecordStore()
    const provider = vi.fn(async () => [[1, 0]])
    const docs = indexer({
      id: 'remote',
      namespace: 'kb',
      records,
      search: inMemorySearchStore(),
      cache: true,
      dense: embedding({
        kind: 'dense',
        name: 'remote-media',
        dimensions: 2,
        maxInputTokens: 100,
        modalities: ['image'],
        batch: { maxSize: 8 },
        embed: provider,
      }),
    })
    const input = [
      schema2MediaDocument({
        namespace: 'kb',
        sourceId: 'remote-photo',
        asset: {
          type: 'url' as const,
          url: new URL('https://cdn.example/dog.png?signature=secret'),
          mediaType: 'image/png',
        },
      }),
    ]

    const first = await docs.indexDocuments(input)
    const second = await docs.indexDocuments(input)

    expect(provider).toHaveBeenCalledTimes(2)
    expect(first.stages?.find((stage) => stage.kind === 'embedding')?.cache).toBe('miss')
    expect(second.stages?.find((stage) => stage.kind === 'embedding')?.cache).toBe('miss')
    expect((await records.list('indexer:remote:namespace:kb:embedding-cache:')).entries).toEqual([])
    const [stored] = (await records.list('indexer:remote:namespace:kb:source:remote-photo:')).entries
    expect(stored.value.source).toMatchObject({ url: 'https://cdn.example/dog.png', mediaType: 'image/png' })
    expect(JSON.stringify(stored.value)).not.toContain('signature=secret')
  })
})

describe('indexer embedding-space guard', () => {
  it('rejects a mixed-space write before embedding and permits it after clear', async () => {
    const records = inMemoryRecordStore()
    const search = inMemorySearchStore()
    const firstProvider = vi.fn(async () => [[1, 0]])
    const secondProvider = vi.fn(async () => [[1, 0, 0]])
    const first = indexer({
      id: 'docs',
      namespace: 'kb',
      records,
      search,
      dense: embedding({
        kind: 'dense',
        name: 'first',
        dimensions: 2,
        maxInputTokens: 100,
        batch: { maxSize: 8 },
        embed: firstProvider,
      }),
    })
    const second = indexer({
      id: 'docs',
      namespace: 'kb',
      records,
      search,
      dense: embedding({
        kind: 'dense',
        name: 'second',
        dimensions: 3,
        maxInputTokens: 100,
        batch: { maxSize: 8 },
        embed: secondProvider,
      }),
    })

    await first.indexDocuments([schema2TextDocument({ namespace: 'kb', sourceId: 'one', content: 'first' })])
    const rejected = second.indexDocuments([{ namespace: 'kb', sourceId: 'two', content: 'second' }])

    await expect(rejected).rejects.toBeInstanceOf(EmbeddingSpaceMismatchError)
    await expect(rejected).rejects.toThrow(/indexer\.clear\(\)|new namespace/)
    expect(secondProvider).not.toHaveBeenCalled()
    await expect(records.list('indexer:docs:namespace:kb:source:two:')).resolves.toMatchObject({ entries: [] })

    await first.clear()
    await expect(
      second.indexDocuments([schema2TextDocument({ namespace: 'kb', sourceId: 'two', content: 'second' })]),
    ).resolves.toMatchObject({
      chunkCount: 1,
    })
    expect(secondProvider).toHaveBeenCalledOnce()
  })

  it('checks an existing mismatch during dry-run without mutating it', async () => {
    const records = inMemoryRecordStore()
    const search = inMemorySearchStore()
    const first = indexer({
      id: 'docs',
      namespace: 'kb',
      records,
      search,
      dense: textEmbedding('first', 2),
    })
    const secondProvider = vi.fn(async () => [[1, 0, 0]])
    const second = indexer({
      id: 'docs',
      namespace: 'kb',
      records,
      search,
      dense: textEmbedding('second', 3, secondProvider),
    })
    await first.indexDocuments([schema2TextDocument({ namespace: 'kb', sourceId: 'one', content: 'first' })])
    const before = await records.get('indexer-namespace:kb:embedding-space')

    await expect(
      second.indexDocuments([{ namespace: 'kb', sourceId: 'two', content: 'second' }], { dryRun: true }),
    ).rejects.toBeInstanceOf(EmbeddingSpaceMismatchError)

    expect(secondProvider).not.toHaveBeenCalled()
    expect(await records.get('indexer-namespace:kb:embedding-space')).toEqual(before)
    await expect(records.list('indexer:docs:namespace:kb:source:two:')).resolves.toMatchObject({ entries: [] })
  })

  it('retains the namespace space claim when only one source is deleted', async () => {
    const records = inMemoryRecordStore()
    const search = inMemorySearchStore()
    const first = indexer({ id: 'docs', namespace: 'kb', records, search, dense: textEmbedding('first', 2) })
    const second = indexer({ id: 'docs', namespace: 'kb', records, search, dense: textEmbedding('second', 3) })

    await first.indexDocuments([schema2TextDocument({ namespace: 'kb', sourceId: 'one', content: 'first' })])
    await first.deleteSource('one')

    await expect(
      second.indexDocuments([{ namespace: 'kb', sourceId: 'two', content: 'second' }]),
    ).rejects.toBeInstanceOf(EmbeddingSpaceMismatchError)
    expect(await records.get('indexer-namespace:kb:embedding-space')).not.toBeNull()
  })
})

function textEmbedding(name: string, dimensions: number, provider = vi.fn(async () => [Array(dimensions).fill(0)])) {
  return embedding({
    kind: 'dense',
    name,
    dimensions,
    maxInputTokens: 100,
    batch: { maxSize: 8 },
    embed: provider,
  })
}
