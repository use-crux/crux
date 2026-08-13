import { describe, expect, it, vi } from 'vitest'
import { embedding } from '../../src/embedding'
import { corpus, indexer } from '../../src/indexing'
import { inMemoryRecordStore, inMemorySearchStore } from '../../src/storage'
import { textOf } from '../embedding/text-input'
import { schema2TextDocument } from '../fixtures/schema2-stored-evidence'

const document = schema2TextDocument({ namespace: 'kb', sourceId: 'intro', content: 'Hello corpus' })

describe('corpus embedding-stage cache integration', () => {
  it('reuses vectors when only indexVersion triggers a reindex', async () => {
    const records = inMemoryRecordStore()
    const search = inMemorySearchStore()
    const { docs, embed } = setup(records, search, 'embedding-v1')

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
    const search = inMemorySearchStore()
    const initial = setup(records, search, 'embedding-v1')
    await initial.docs.sync([document])
    const previous = await initial.docs.getSource('intro')

    const changed = setup(records, search, 'embedding-v2')
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
  search: ReturnType<typeof inMemorySearchStore>,
  version: string,
) {
  const embed = vi.fn(async (inputs) => inputs.map((input) => [textOf(input).length, 1]))
  const docsIndexer = indexer({
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
