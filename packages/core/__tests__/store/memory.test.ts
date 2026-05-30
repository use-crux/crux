import { describe, it, expect, vi } from 'vitest'
import { inMemoryCruxStore } from '../../store/memory'
import type { CruxStore, StoreEvent } from '../../store/types'

describe('inMemoryCruxStore', () => {
  // ── Basic CRUD ──

  it('get returns null for missing key', async () => {
    const store = inMemoryCruxStore()
    expect(await store.get('missing')).toBeNull()
  })

  it('set + get round-trips a JsonObject', async () => {
    const store = inMemoryCruxStore()
    await store.set('k1', { title: 'hello', count: 42, nested: { a: 1 } })

    const value = await store.get('k1')
    expect(value).not.toBeNull()
    expect(value!.title).toBe('hello')
    expect(value!.count).toBe(42)
    expect(value!.nested).toEqual({ a: 1 })
  })

  it('set overwrites existing value', async () => {
    const store = inMemoryCruxStore()
    await store.set('k1', { version: 1 })
    await store.set('k1', { version: 2, extra: true })

    const value = await store.get('k1')
    expect(value!.version).toBe(2)
    expect(value!.extra).toBe(true)
  })

  it('stores a defensive copy — mutations to original do not affect stored value', async () => {
    const store = inMemoryCruxStore()
    const obj = { data: 'original' }
    await store.set('k1', obj)

    obj.data = 'mutated'
    const value = await store.get('k1')
    expect(value!.data).toBe('original')
  })

  it('returns a defensive copy — mutations to returned value do not affect store', async () => {
    const store = inMemoryCruxStore()
    await store.set('k1', { data: 'original' })

    const value = await store.get('k1')
    value!.data = 'mutated'

    const fresh = await store.get('k1')
    expect(fresh!.data).toBe('original')
  })

  it('delete removes entry', async () => {
    const store = inMemoryCruxStore()
    await store.set('k1', { v: 1 })
    await store.delete('k1')
    expect(await store.get('k1')).toBeNull()
  })

  it('delete is no-op for missing key', async () => {
    const store = inMemoryCruxStore()
    await store.delete('missing') // should not throw
  })

  // ── List ──

  describe('list', () => {
    it('returns all entries matching empty prefix', async () => {
      const store = inMemoryCruxStore()
      await store.set('a', { v: 1 })
      await store.set('b', { v: 2 })

      const result = await store.list('')
      expect(result.entries).toHaveLength(2)
    })

    it('filters by prefix', async () => {
      const store = inMemoryCruxStore()
      await store.set('user:1', { name: 'Alice' })
      await store.set('user:2', { name: 'Bob' })
      await store.set('post:1', { title: 'Hello' })

      const result = await store.list('user:')
      expect(result.entries).toHaveLength(2)
      expect(result.entries.every((e) => e.key.startsWith('user:'))).toBe(true)
    })

    it('filters by value fields', async () => {
      const store = inMemoryCruxStore()
      await store.set('k1', { type: 'note', content: 'a' })
      await store.set('k2', { type: 'task', content: 'b' })
      await store.set('k3', { type: 'note', content: 'c' })

      const result = await store.list('', { filter: { type: 'note' } })
      expect(result.entries).toHaveLength(2)
    })

    it('filter with null matches missing or null fields', async () => {
      const store = inMemoryCruxStore()
      await store.set('k1', { status: 'active' })
      await store.set('k2', { status: null })
      await store.set('k3', { name: 'no-status-field' })

      const result = await store.list('', { filter: { status: null } })
      // k2 (explicit null) and k3 (missing field) should match
      expect(result.entries).toHaveLength(2)
      const keys = result.entries.map((e) => e.key)
      expect(keys).toContain('k2')
      expect(keys).toContain('k3')
    })

    it('respects limit', async () => {
      const store = inMemoryCruxStore()
      for (let i = 0; i < 10; i++) {
        await store.set(`k${i}`, { v: i })
      }

      const result = await store.list('', { limit: 3 })
      expect(result.entries).toHaveLength(3)
    })

    it('paginates with cursor', async () => {
      const store = inMemoryCruxStore()
      // Insert with staggered updatedAt so sort order is deterministic
      for (let i = 0; i < 5; i++) {
        await store.set(`k${i}`, { v: i, updatedAt: 1000 + i })
      }

      const page1 = await store.list('', { limit: 2 })
      expect(page1.entries).toHaveLength(2)
      expect(page1.cursor).toBeDefined()

      const page2 = await store.list('', { limit: 2, cursor: page1.cursor })
      expect(page2.entries).toHaveLength(2)
      // No overlap with page1
      const page1Keys = page1.entries.map((e) => e.key)
      const page2Keys = page2.entries.map((e) => e.key)
      expect(page1Keys.filter((k) => page2Keys.includes(k))).toHaveLength(0)

      const page3 = await store.list('', { limit: 2, cursor: page2.cursor })
      expect(page3.entries).toHaveLength(1)
      expect(page3.cursor).toBeUndefined() // no more pages
    })

    it('sorts by updatedAt descending', async () => {
      const store = inMemoryCruxStore()
      await store.set('old', { v: 1, updatedAt: 100 })
      await store.set('new', { v: 2, updatedAt: 200 })

      const result = await store.list('')
      expect(result.entries[0].key).toBe('new')
      expect(result.entries[1].key).toBe('old')
    })

    it('returns empty for no matches', async () => {
      const store = inMemoryCruxStore()
      await store.set('k1', { v: 1 })

      const result = await store.list('nonexistent:')
      expect(result.entries).toHaveLength(0)
      expect(result.cursor).toBeUndefined()
    })

    it('combines prefix + filter', async () => {
      const store = inMemoryCruxStore()
      await store.set('task:1', { status: 'done' })
      await store.set('task:2', { status: 'pending' })
      await store.set('note:1', { status: 'done' })

      const result = await store.list('task:', { filter: { status: 'done' } })
      expect(result.entries).toHaveLength(1)
      expect(result.entries[0].key).toBe('task:1')
    })
  })

  // ── Vector Search ──

  describe('vectorSearch', () => {
    it('returns empty when no entries have embeddings', async () => {
      const store = inMemoryCruxStore()
      await store.set('k1', { content: 'hello' })

      const result = await store.vectorSearch!([1, 0, 0])
      expect(result).toHaveLength(0)
    })

    it('finds similar entries by cosine similarity', async () => {
      const store = inMemoryCruxStore()
      await store.set('k1', { content: 'cat', embedding: [1, 0, 0] })
      await store.set('k2', { content: 'dog', embedding: [0.9, 0.1, 0] })
      await store.set('k3', { content: 'car', embedding: [0, 0, 1] })

      const result = await store.vectorSearch!([1, 0, 0])
      expect(result.length).toBeGreaterThanOrEqual(2)
      expect(result[0].key).toBe('k1')
      expect(result[0].score).toBeCloseTo(1.0)
      expect(result[result.length - 1].key).toBe('k3')
    })

    it('respects threshold', async () => {
      const store = inMemoryCruxStore()
      await store.set('k1', { embedding: [1, 0] })
      await store.set('k2', { embedding: [0, 1] })

      const result = await store.vectorSearch!([1, 0], { threshold: 0.9 })
      expect(result).toHaveLength(1)
      expect(result[0].key).toBe('k1')
    })

    it('respects limit', async () => {
      const store = inMemoryCruxStore()
      for (let i = 0; i < 10; i++) {
        await store.set(`k${i}`, { embedding: [i / 10, 1 - i / 10] })
      }

      const result = await store.vectorSearch!([0.5, 0.5], { limit: 3 })
      expect(result).toHaveLength(3)
    })

    it('filters by value fields', async () => {
      const store = inMemoryCruxStore()
      await store.set('k1', { type: 'note', embedding: [1, 0] })
      await store.set('k2', { type: 'task', embedding: [0.9, 0.1] })

      const result = await store.vectorSearch!([1, 0], { filter: { type: 'task' } })
      expect(result).toHaveLength(1)
      expect(result[0].key).toBe('k2')
    })
  })

  // ── TTL ──

  describe('TTL', () => {
    it('get returns null after TTL expires', async () => {
      vi.useFakeTimers()
      try {
        const store = inMemoryCruxStore()
        await store.set('k1', { v: 1 }, { ttl: 1000 })

        // Before expiry
        expect(await store.get('k1')).not.toBeNull()

        // After expiry
        vi.advanceTimersByTime(1001)
        expect(await store.get('k1')).toBeNull()
      } finally {
        vi.useRealTimers()
      }
    })

    it('get returns value before TTL expires', async () => {
      vi.useFakeTimers()
      try {
        const store = inMemoryCruxStore()
        await store.set('k1', { v: 1 }, { ttl: 5000 })

        vi.advanceTimersByTime(4999)
        const value = await store.get('k1')
        expect(value).not.toBeNull()
        expect(value!.v).toBe(1)
      } finally {
        vi.useRealTimers()
      }
    })

    it('set without TTL does not expire', async () => {
      vi.useFakeTimers()
      try {
        const store = inMemoryCruxStore()
        await store.set('k1', { v: 1 })

        vi.advanceTimersByTime(999_999_999)
        expect(await store.get('k1')).not.toBeNull()
      } finally {
        vi.useRealTimers()
      }
    })

    it('list excludes expired entries', async () => {
      vi.useFakeTimers()
      try {
        const store = inMemoryCruxStore()
        await store.set('k1', { v: 1 }, { ttl: 1000 })
        await store.set('k2', { v: 2 }) // no TTL

        vi.advanceTimersByTime(1001)

        const result = await store.list('')
        expect(result.entries).toHaveLength(1)
        expect(result.entries[0].key).toBe('k2')
      } finally {
        vi.useRealTimers()
      }
    })

    it('overwriting with new TTL resets expiry', async () => {
      vi.useFakeTimers()
      try {
        const store = inMemoryCruxStore()
        await store.set('k1', { v: 1 }, { ttl: 1000 })

        vi.advanceTimersByTime(500)
        // Overwrite with a fresh TTL
        await store.set('k1', { v: 2 }, { ttl: 1000 })

        vi.advanceTimersByTime(800) // 1300ms total, past first TTL
        const value = await store.get('k1')
        expect(value).not.toBeNull()
        expect(value!.v).toBe(2)
      } finally {
        vi.useRealTimers()
      }
    })

    it('overwriting without TTL removes expiry', async () => {
      vi.useFakeTimers()
      try {
        const store = inMemoryCruxStore()
        await store.set('k1', { v: 1 }, { ttl: 1000 })

        // Overwrite without TTL
        await store.set('k1', { v: 2 })

        vi.advanceTimersByTime(5000)
        expect(await store.get('k1')).not.toBeNull()
      } finally {
        vi.useRealTimers()
      }
    })

    it('supportsTtl returns true', () => {
      const store = inMemoryCruxStore()
      expect(store.supportsTtl!()).toBe(true)
    })
  })

  // ── Subscribe ──

  describe('subscribe', () => {
    it('emits set events', async () => {
      const store = inMemoryCruxStore()
      const events: StoreEvent[] = []
      store.subscribe!((e) => events.push(e))

      await store.set('k1', { v: 1 })

      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('set')
      expect(events[0].key).toBe('k1')
      if (events[0].type === 'set') {
        expect(events[0].value.v).toBe(1)
      }
    })

    it('emits delete events', async () => {
      const store = inMemoryCruxStore()
      await store.set('k1', { v: 1 })

      const events: StoreEvent[] = []
      store.subscribe!((e) => events.push(e))

      await store.delete('k1')

      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('delete')
      expect(events[0].key).toBe('k1')
    })

    it('unsubscribe stops events', async () => {
      const store = inMemoryCruxStore()
      const events: StoreEvent[] = []
      const unsub = store.subscribe!((e) => events.push(e))

      await store.set('k1', { v: 1 })
      expect(events).toHaveLength(1)

      unsub()
      await store.set('k2', { v: 2 })
      expect(events).toHaveLength(1) // no new events
    })

    it('supports multiple subscribers', async () => {
      const store = inMemoryCruxStore()
      const events1: StoreEvent[] = []
      const events2: StoreEvent[] = []

      store.subscribe!((e) => events1.push(e))
      store.subscribe!((e) => events2.push(e))

      await store.set('k1', { v: 1 })

      expect(events1).toHaveLength(1)
      expect(events2).toHaveLength(1)
    })
  })
})
