import { describe, expect, it } from 'vitest'
import { convexStorage } from '../src'
import { episodes, inMemoryRecordStore, inMemorySearchStore, memory } from '../src/memory'
import { convexRuntimeStorage } from '../src/runtime'
import { createInMemoryConvexStoreDocumentComponent } from '../src/store-document-component'

describe('Convex memory storage', () => {
  it('round-trips the full embedded episode record', async () => {
    const component = createInMemoryConvexStoreDocumentComponent()
    const storage = convexStorage({ component, ctx: component.ctx })
    const block = episodes({
      id: 'episodes',
      embed: async () => [1, 0],
    })

    const key = await block.record(
      {
        content: 'User asked about pricing',
        metadata: { source: 'support' },
      },
      {
        ...storage,
        namespace: 'user:1',
        memoryId: 'support-memory',
      },
    )

    await expect(storage.records.get(key)).resolves.toMatchObject({
      content: 'User asked about pricing',
      createdAt: expect.any(Number),
      metadata: { source: 'support' },
      embedding: [1, 0],
    })
  })

  it('does not expose bundled search storage', () => {
    const component = createInMemoryConvexStoreDocumentComponent()
    const storage = convexStorage({ component, ctx: component.ctx })

    expect(storage.search).toBeUndefined()
    expect(convexRuntimeStorage.search).toBeUndefined()
  })

  it('falls back to record listing for semantic episodes without search', async () => {
    const component = createInMemoryConvexStoreDocumentComponent()
    const storage = convexStorage({ component, ctx: component.ctx })
    const block = episodes({
      id: 'episodes',
      embed: async () => [1, 0],
    })
    const options = {
      ...storage,
      namespace: 'user:1',
      memoryId: 'support-memory',
    }

    await block.record({ content: 'User asked about pricing' }, options)
    await block.record({ content: 'We discussed React hooks' }, options)

    const results = await block.recall('pricing', options)

    expect(results.map((entry) => entry.content).sort()).toEqual([
      'User asked about pricing',
      'We discussed React hooks',
    ])
  })

  it('uses explicit records without requiring an active Convex runtime', async () => {
    const records = inMemoryRecordStore()
    const block = episodes({
      id: 'episodes',
      embed: async () => [1, 0],
    })
    const configuredMemory = memory({
      id: 'explicit-records',
      records,
      namespace: 'user:1',
      blocks: [block],
      capture: { mode: 'inline' },
    })

    await expect(
      configuredMemory.captureTurn({
        messages: [{ role: 'user', content: 'Remember the pricing discussion' }],
      }),
    ).resolves.toBeUndefined()

    const entries = await block.list({ records, namespace: 'user:1', memoryId: configuredMemory.id })
    expect(entries).toEqual([
      expect.objectContaining({
        content: 'user: Remember the pricing discussion',
      }),
    ])
    await expect(records.get(entries[0].key)).resolves.toMatchObject({ embedding: [1, 0] })
  })

  it('preserves an explicit user-provided SearchStore', async () => {
    const records = inMemoryRecordStore()
    const search = inMemorySearchStore()
    const block = episodes({
      id: 'episodes',
      embed: async () => [1, 0],
    })
    const configuredMemory = memory({
      id: 'explicit-search',
      records,
      search,
      namespace: 'user:1',
      blocks: [block],
      capture: { mode: 'inline' },
    })

    await configuredMemory.captureTurn({
      messages: [{ role: 'user', content: 'Remember the pricing discussion' }],
    })
    const results = await block.recall('pricing', {
      records,
      search,
      namespace: 'user:1',
      memoryId: configuredMemory.id,
    })

    expect(results).toEqual([
      expect.objectContaining({
        content: 'user: Remember the pricing discussion',
        score: expect.any(Number),
      }),
    ])
  })
})
