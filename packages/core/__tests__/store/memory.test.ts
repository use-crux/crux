import { describe, expect, it } from 'vitest'
import { inMemoryBlobStore, inMemoryRecordStore, inMemoryVectorStore } from '../../storage'
import {
  describeBlobStoreConformance,
  describeRecordStoreConformance,
  vectorStoreConformanceSuite,
} from '../../storage/testing/vitest'
import type { RecordEvent } from '../../storage'

describeRecordStoreConformance({
  name: 'inMemoryRecordStore',
  prepare: () => inMemoryRecordStore(),
})

vectorStoreConformanceSuite({
  name: 'inMemoryVectorStore',
  create: () => ({
    records: inMemoryRecordStore(),
    vectors: inMemoryVectorStore(),
    cleanup: async () => {},
  }),
  capabilities: { sparse: true, hybrid: true, delete: true },
})

describeBlobStoreConformance({
  name: 'inMemoryBlobStore',
  prepare: () => inMemoryBlobStore(),
})

describe('inMemoryRecordStore subscriptions', () => {
  it('emits put and delete events to active watchers', async () => {
    const store = inMemoryRecordStore()
    const events: RecordEvent[] = []
    const unsubscribe = store.watch!('', (event) => events.push(event))

    await store.put('k1', { v: 1 })
    await store.delete('k1')
    unsubscribe()
    await store.put('k2', { v: 2 })

    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({ type: 'put', key: 'k1' })
    if (events[0]?.type === 'put') {
      expect(events[0].value).toEqual({ v: 1 })
    }
    expect(events[1]).toMatchObject({ type: 'delete', key: 'k1' })
  })
})
