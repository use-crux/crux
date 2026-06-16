import { describe, expect, it } from 'vitest'
import { createStoreDocStore, type StoreDocComponentPort, type StoreDocPage, type StoreDocRecord } from '../store-doc'

describe('store document list contract', () => {
  it('fills component pages until a filtered list reaches the requested limit', async () => {
    const calls: Array<{ prefix: string; limit?: number; cursor?: string }> = []
    const pages = new Map<string, StoreDocPage>([
      [
        'start',
        {
          docs: [
            cruxDoc('memory:draft', { kind: 'draft', text: 'Skip me' }),
            cruxDoc('memory:note-1', { kind: 'note', text: 'Alpha' }),
          ],
          cursor: 'cursor-1',
        },
      ],
      [
        'cursor-1',
        {
          docs: [cruxDoc('memory:note-2', { kind: 'note', text: 'Beta' })],
          cursor: 'cursor-2',
        },
      ],
    ])
    const store = createStoreDocStore({
      io: {
        async get() {
          return null
        },
        async list(query) {
          calls.push(query)
          return pages.get(query.cursor ?? 'start') ?? { docs: [] }
        },
        async put() {},
        async delete() {},
      } satisfies StoreDocComponentPort,
    })

    await expect(store.list('memory:', { limit: 2, filter: { kind: 'note' } })).resolves.toEqual({
      entries: [
        { key: 'memory:note-1', value: { kind: 'note', text: 'Alpha' } },
        { key: 'memory:note-2', value: { kind: 'note', text: 'Beta' } },
      ],
      cursor: 'cursor-2',
    })
    expect(calls).toEqual([
      { prefix: 'memory:', limit: 2 },
      { prefix: 'memory:', limit: 1, cursor: 'cursor-1' },
    ])
  })
})

function cruxDoc(key: string, value: StoreDocRecord): StoreDocRecord {
  return {
    key,
    content: JSON.stringify(value),
    metadata: { _cruxDoc: true },
    createdAt: 1,
    updatedAt: 2,
  }
}
