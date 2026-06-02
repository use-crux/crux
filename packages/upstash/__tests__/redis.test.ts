import { describe, it, expect, vi, beforeEach } from 'vitest'
import { cruxRedisStore } from '../redis'
import type { RedisClient, RedisSubscriber } from '../redis'

// ── Mock Redis Client ──

function createMockRedis(): RedisClient & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    async get<T = string>(key: string): Promise<T | null> {
      const val = data.get(key)
      return val !== undefined ? (val as T) : null
    },
    async set(key: string, value: string) {
      data.set(key, value)
      return 'OK'
    },
    async del(...keys: string[]) {
      let count = 0
      for (const key of keys) {
        if (data.delete(key)) count++
      }
      return count
    },
    async keys(pattern: string) {
      const prefix = pattern.replace('*', '')
      return Array.from(data.keys()).filter((k) => k.startsWith(prefix))
    },
    async publish() {
      return 0
    },
  }
}

function createObjectReturningMockRedis(): RedisClient & { data: Map<string, string> } {
  const redis = createMockRedis()
  return {
    ...redis,
    async get<T = string>(key: string): Promise<T | null> {
      const val = redis.data.get(key)
      return val !== undefined ? (JSON.parse(val) as T) : null
    },
  }
}

describe('cruxRedisStore', () => {
  let redis: ReturnType<typeof createMockRedis>

  beforeEach(() => {
    redis = createMockRedis()
  })

  it('get returns null for missing key', async () => {
    const store = cruxRedisStore({ redis })
    expect(await store.get('missing')).toBeNull()
  })

  it('set + get round-trips a JsonObject', async () => {
    const store = cruxRedisStore({ redis })
    await store.set('plan:p1', { id: 'p1', title: 'Test', version: 1 })

    const value = await store.get('plan:p1')
    expect(value).not.toBeNull()
    expect(value!.title).toBe('Test')
    expect(value!.version).toBe(1)
  })

  it('get accepts Redis clients that return parsed JSON objects', async () => {
    const objectRedis = createObjectReturningMockRedis()
    const store = cruxRedisStore({ redis: objectRedis })
    await store.set('plan:p1', { id: 'p1', title: 'Test', version: 1 })

    const value = await store.get('plan:p1')
    expect(value).toEqual({ id: 'p1', title: 'Test', version: 1 })
  })

  it('set overwrites existing value', async () => {
    const store = cruxRedisStore({ redis })
    await store.set('k1', { v: 1 })
    await store.set('k1', { v: 2 })

    const value = await store.get('k1')
    expect(value!.v).toBe(2)
  })

  it('delete removes entry', async () => {
    const store = cruxRedisStore({ redis })
    await store.set('k1', { v: 1 })
    await store.delete('k1')
    expect(await store.get('k1')).toBeNull()
  })

  it('delete is no-op for missing key', async () => {
    const store = cruxRedisStore({ redis })
    await store.delete('missing') // should not throw
  })

  it('uses configured prefix for keys', async () => {
    const store = cruxRedisStore({ redis, prefix: 'myapp:' })
    await store.set('plan:p1', { title: 'Test' })

    // Stored under prefixed key
    expect(redis.data.has('myapp:plan:p1')).toBe(true)
    expect(redis.data.has('plan:p1')).toBe(false)

    // Readable via store
    const value = await store.get('plan:p1')
    expect(value!.title).toBe('Test')
  })

  describe('list', () => {
    it('returns entries matching prefix', async () => {
      const store = cruxRedisStore({ redis })
      await store.set('plan:p1', { title: 'A', updatedAt: 100 })
      await store.set('plan:p2', { title: 'B', updatedAt: 200 })
      await store.set('task:t1', { label: 'X', updatedAt: 300 })

      const result = await store.list('plan:')
      expect(result.entries).toHaveLength(2)
      expect(result.entries.every((e) => e.key.startsWith('plan:'))).toBe(true)
    })

    it('accepts Redis clients that return parsed JSON objects', async () => {
      const objectRedis = createObjectReturningMockRedis()
      const store = cruxRedisStore({ redis: objectRedis })
      await store.set('plan:p1', { title: 'A', updatedAt: 100 })
      await store.set('plan:p2', { title: 'B', updatedAt: 200 })

      const result = await store.list('plan:')
      expect(result.entries).toHaveLength(2)
      expect(result.entries[0].value.title).toBe('B')
    })

    it('filters by value fields', async () => {
      const store = cruxRedisStore({ redis })
      await store.set('tl:1', { status: 'active', updatedAt: 100 })
      await store.set('tl:2', { status: 'done', updatedAt: 200 })
      await store.set('tl:3', { status: 'active', updatedAt: 300 })

      const result = await store.list('tl:', { filter: { status: 'active' } })
      expect(result.entries).toHaveLength(2)
    })

    it('supports dot-path filters', async () => {
      const store = cruxRedisStore({ redis })
      await store.set('tl:1', {
        metadata: { threadId: 'abc' },
        updatedAt: 100,
      })
      await store.set('tl:2', {
        metadata: { threadId: 'def' },
        updatedAt: 200,
      })

      const result = await store.list('tl:', {
        filter: { 'metadata.threadId': 'abc' },
      })
      expect(result.entries).toHaveLength(1)
      expect(result.entries[0].key).toBe('tl:1')
    })

    it('sorts by updatedAt descending', async () => {
      const store = cruxRedisStore({ redis })
      await store.set('k:old', { v: 1, updatedAt: 100 })
      await store.set('k:new', { v: 2, updatedAt: 200 })

      const result = await store.list('k:')
      expect(result.entries[0].key).toBe('k:new')
      expect(result.entries[1].key).toBe('k:old')
    })

    it('respects limit', async () => {
      const store = cruxRedisStore({ redis })
      for (let i = 0; i < 5; i++) {
        await store.set(`k:${i}`, { v: i, updatedAt: i * 100 })
      }

      const result = await store.list('k:', { limit: 2 })
      expect(result.entries).toHaveLength(2)
    })
  })

  describe('publish', () => {
    it('publishes on set', async () => {
      const publishSpy = vi.fn().mockResolvedValue(0)
      redis.publish = publishSpy

      const store = cruxRedisStore({ redis })
      await store.set('plan:p1', { title: 'Test' })

      expect(publishSpy).toHaveBeenCalledWith('crux:events', expect.any(String))
      const payload = JSON.parse(publishSpy.mock.calls[0][1])
      expect(payload.key).toBe('plan:p1')
      expect(payload.type).toBe('set')
    })

    it('publishes on delete', async () => {
      const publishSpy = vi.fn().mockResolvedValue(0)
      redis.publish = publishSpy

      const store = cruxRedisStore({ redis })
      await store.set('k1', { v: 1 })
      publishSpy.mockClear()

      await store.delete('k1')
      expect(publishSpy).toHaveBeenCalledWith('crux:events', expect.any(String))
      const payload = JSON.parse(publishSpy.mock.calls[0][1])
      expect(payload.type).toBe('delete')
    })
  })

  describe('subscribe', () => {
    it('is not available without a subscriber', () => {
      const store = cruxRedisStore({ redis })
      expect(store.subscribe).toBeUndefined()
    })

    it('is available with a subscriber', () => {
      const subscriber: RedisSubscriber = {
        subscribe: vi.fn().mockResolvedValue(undefined),
        unsubscribe: vi.fn().mockResolvedValue(undefined),
      }
      const store = cruxRedisStore({ redis, subscriber })
      expect(store.subscribe).toBeDefined()
    })
  })

  describe('vector hooks', () => {
    it('does not expose vector search without product-specific vector hooks', () => {
      const store = cruxRedisStore({ redis })

      expect(store.searchVectors).toBeUndefined()
      expect(store.vectorSearch).toBeUndefined()
      expect(store.capabilities?.().vectorSearch).toBeUndefined()
    })

    it('exposes dense vector search when vector hooks are configured', async () => {
      const searchVectors = vi.fn().mockResolvedValue([{ key: 'cache:1', score: 0.99 }])
      const upsert = vi.fn().mockResolvedValue(undefined)
      const store = cruxRedisStore({
        redis,
        vector: {
          upsert,
          searchVectors,
          capabilities: { dense: true },
          semanticCache: { isolatedVectorNamespace: true },
        },
      })

      await store.set('cache:1', {
        cruxType: 'semantic-cache-entry',
        scopeHash: 'scope',
        embedding: [1, 0, 0],
        result: { text: 'cached' },
      })

      const results = await store.searchVectors!({
        dense: [1, 0, 0],
        filter: { cruxType: 'semantic-cache-entry' },
      })

      expect(upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          key: 'cache:1',
          redisKey: 'crux:cache:1',
        }),
      )
      expect(searchVectors).toHaveBeenCalledWith(expect.objectContaining({ dense: [1, 0, 0] }), expect.any(Object))
      expect(results).toEqual([
        {
          key: 'cache:1',
          score: 0.99,
          value: {
            cruxType: 'semantic-cache-entry',
            scopeHash: 'scope',
            embedding: [1, 0, 0],
            result: { text: 'cached' },
          },
        },
      ])
      expect(store.capabilities?.().semanticCache?.isolatedVectorNamespace).toBe(true)
    })

    it('throws explicit sparse errors when hooks are dense-only', async () => {
      const store = cruxRedisStore({
        redis,
        vector: {
          searchVectors: vi.fn(),
          capabilities: { dense: true, sparse: false, hybrid: false },
        },
      })

      await expect(store.searchVectors!({ sparse: { indices: [1], values: [1] } })).rejects.toThrow(
        /do not support sparse/i,
      )
      await expect(
        store.searchVectors!({ dense: [1], sparse: { indices: [1], values: [1] } }),
      ).rejects.toThrow(/do not support hybrid/i)
    })
  })
})
