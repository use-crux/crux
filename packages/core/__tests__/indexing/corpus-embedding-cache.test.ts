import { describe, expect, it, vi } from 'vitest'
import { embedding } from '../../src/embedding'
import { corpus, indexer } from '../../src/indexing'
import { inMemoryRecordStore, inMemoryVectorStore } from '../../src/storage'
import { textOf } from '../embedding/text-input'

const document = { namespace: 'kb', sourceId: 'intro', content: 'Hello corpus' }

describe('corpus embedding-stage cache integration', () => {
  it('reuses vectors when only indexVersion triggers a reindex', async () => {
    const records = inMemoryRecordStore()
    const vectors = inMemoryVectorStore()
    const { docs, embed } = setup(records, vectors, 'embedding-v1')

    await docs.sync([document], { indexVersion: 'index-v1' })
    embed.mockClear()
    const result = await docs.sync([document], { indexVersion: 'index-v2' })

    expect(embed).not.toHaveBeenCalled()
    expect(result).toMatchObject({ changed: 1, chunkCount: 1 })
    expect(result.sources[0]).toMatchObject({ action: 'changed', reason: 'indexChanged' })
    await expect(docs.getSource('intro')).resolves.toMatchObject({
      stages: expect.arrayContaining([
        expect.objectContaining({ kind: 'embedding', embeddingKind: 'dense', cache: 'hit' }),
      ]),
    })
  })

  it('keeps skipping an append-only source after an embedding fingerprint changes', async () => {
    const records = inMemoryRecordStore()
    const vectors = inMemoryVectorStore()
    const initial = setup(records, vectors, 'embedding-v1')
    await initial.docs.sync([document])
    const previous = await initial.docs.getSource('intro')

    const changed = setup(records, vectors, 'embedding-v2')
    const first = await changed.docs.sync([document], { mode: 'appendOnly' })
    const second = await changed.docs.sync([document], { mode: 'appendOnly' })

    expect(changed.embed).not.toHaveBeenCalled()
    expect(first).toMatchObject({ changed: 1, skipped: 1, chunkCount: 0 })
    expect(second).toMatchObject({ changed: 1, skipped: 1, chunkCount: 0 })
    expect(first.sources[0]).toMatchObject({ action: 'skipped', reason: 'appendOnly' })
    expect(second.sources[0]).toMatchObject({ action: 'skipped', reason: 'appendOnly' })
    await expect(changed.docs.getSource('intro')).resolves.toMatchObject({
      indexHash: previous?.indexHash,
    })
  })
})

function setup(
  records: ReturnType<typeof inMemoryRecordStore>,
  vectors: ReturnType<typeof inMemoryVectorStore>,
  version: string,
) {
  const embed = vi.fn(async (inputs) => inputs.map((input) => [textOf(input).length, 1]))
  const docsIndexer = indexer({
    id: 'docs',
    namespace: 'kb',
    records,
    vectors,
    dense: embedding({
      kind: 'dense',
      name: 'dense-test',
      dimensions: 2,
      maxInputTokens: 100,
      batch: { maxSize: 8 },
      version,
      embed,
    }),
    cache: true,
  })
  return {
    embed,
    docs: corpus({ id: 'docs', namespace: 'kb', records, indexer: docsIndexer }),
  }
}
