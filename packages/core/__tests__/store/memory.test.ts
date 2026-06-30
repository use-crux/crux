import { describe, expect, it } from 'vitest'
import { inMemoryBlobStore, inMemoryRecordStore, inMemoryVectorStore } from '../../storage'
import {
  describeBlobStoreConformance,
  describeRecordStoreConformance,
  describeVectorStoreConformance,
} from '../../storage/testing/vitest'
import { inMemoryCruxStore } from '../../store/memory'
import type { StoreEvent } from '../../store/types'

describeRecordStoreConformance({
  name: 'inMemoryRecordStore',
  prepare: () => inMemoryRecordStore(),
})

describeVectorStoreConformance({
  name: 'inMemoryVectorStore',
  prepare: () => inMemoryVectorStore(),
})

describeBlobStoreConformance({
  name: 'inMemoryBlobStore',
  prepare: () => inMemoryBlobStore(),
})

describe('inMemoryCruxStore subscriptions', () => {
  it('emits set and delete events to active subscribers', async () => {
    const store = inMemoryCruxStore()
    const events: StoreEvent[] = []
    const unsubscribe = store.subscribe!((event) => events.push(event))

    await store.set('k1', { v: 1 })
    await store.delete('k1')
    unsubscribe()
    await store.set('k2', { v: 2 })

    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({ type: 'set', key: 'k1' })
    if (events[0]?.type === 'set') {
      expect(events[0].value).toEqual({ v: 1 })
    }
    expect(events[1]).toMatchObject({ type: 'delete', key: 'k1' })
  })
})
