import { describe, it, expect, vi } from 'vitest'
import { GoogleCacheManager } from '../cache-manager'
import { CACHE_DEFAULTS } from '../cache-types'
import type { SystemBlock } from '@use-crux/core'

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

function block(text: string, providerCache = true): SystemBlock {
  return { source: `context:${text}`, text, providerCache }
}

function createMockClient(cacheName: string = 'cachedContents/abc123') {
  return {
    caches: {
      create: vi.fn().mockResolvedValue({ name: cacheName }),
      delete: vi.fn().mockResolvedValue({}),
      get: vi.fn().mockResolvedValue({ name: cacheName }),
      update: vi.fn().mockResolvedValue({ name: cacheName }),
    },
  }
}

// ─────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────

describe('GoogleCacheManager', () => {
  describe('computeKey', () => {
    it('returns the same key for the same model and texts', () => {
      const client = createMockClient()
      const manager = new GoogleCacheManager(client as any, CACHE_DEFAULTS)

      const key1 = manager.computeKey('gemini-2.5-flash', ['block1', 'block2'])
      const key2 = manager.computeKey('gemini-2.5-flash', ['block1', 'block2'])

      expect(key1).toBe(key2)
    })

    it('returns different keys for different models', () => {
      const client = createMockClient()
      const manager = new GoogleCacheManager(client as any, CACHE_DEFAULTS)

      const key1 = manager.computeKey('gemini-2.5-flash', ['block1'])
      const key2 = manager.computeKey('gemini-2.5-pro', ['block1'])

      expect(key1).not.toBe(key2)
    })

    it('returns different keys for different text order', () => {
      const client = createMockClient()
      const manager = new GoogleCacheManager(client as any, CACHE_DEFAULTS)

      const key1 = manager.computeKey('gemini-2.5-flash', ['block1', 'block2'])
      const key2 = manager.computeKey('gemini-2.5-flash', ['block2', 'block1'])

      expect(key1).not.toBe(key2)
    })

    it('returns different keys for different texts', () => {
      const client = createMockClient()
      const manager = new GoogleCacheManager(client as any, CACHE_DEFAULTS)

      const key1 = manager.computeKey('gemini-2.5-flash', ['hello'])
      const key2 = manager.computeKey('gemini-2.5-flash', ['world'])

      expect(key1).not.toBe(key2)
    })
  })

  describe('resolve', () => {
    it('reuses an existing cache on the second call with same inputs', async () => {
      const client = createMockClient('cachedContents/reused')
      const manager = new GoogleCacheManager(client as any, CACHE_DEFAULTS)
      const blocks = [block('stable content')]

      const name1 = await manager.resolve('gemini-2.5-flash', blocks)
      const name2 = await manager.resolve('gemini-2.5-flash', blocks)

      expect(name1).toBe('cachedContents/reused')
      expect(name2).toBe('cachedContents/reused')
      expect(client.caches.create).toHaveBeenCalledOnce()
    })

    it('deduplicates concurrent resolve calls for the same content', async () => {
      let resolveCreate!: (value: { name: string }) => void
      const client = createMockClient()
      client.caches.create = vi.fn().mockReturnValue(
        new Promise((resolve) => {
          resolveCreate = resolve
        }),
      )
      const manager = new GoogleCacheManager(client as any, CACHE_DEFAULTS)
      const blocks = [block('concurrent content')]

      // Fire two resolves concurrently
      const p1 = manager.resolve('gemini-2.5-flash', blocks)
      const p2 = manager.resolve('gemini-2.5-flash', blocks)

      // Resolve the single create call
      resolveCreate({ name: 'cachedContents/deduped' })

      const [name1, name2] = await Promise.all([p1, p2])
      expect(name1).toBe('cachedContents/deduped')
      expect(name2).toBe('cachedContents/deduped')
      expect(client.caches.create).toHaveBeenCalledOnce()
    })

    it('recreates cache after TTL expires', async () => {
      vi.useFakeTimers()
      try {
        const client = createMockClient('cachedContents/first')
        const manager = new GoogleCacheManager(client as any, {
          ...CACHE_DEFAULTS,
          defaultTtlSeconds: 60,
        })
        const blocks = [block('expiring content')]

        const name1 = await manager.resolve('gemini-2.5-flash', blocks)
        expect(name1).toBe('cachedContents/first')

        // Advance past TTL
        vi.advanceTimersByTime(61_000)

        // Mock returns a new cache name for second creation
        client.caches.create.mockResolvedValue({ name: 'cachedContents/second' })

        const name2 = await manager.resolve('gemini-2.5-flash', blocks)
        expect(name2).toBe('cachedContents/second')
        expect(client.caches.create).toHaveBeenCalledTimes(2)
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe('eviction', () => {
    it('evicts oldest entries when maxEntries is exceeded', async () => {
      const client = createMockClient()
      let callCount = 0
      client.caches.create = vi.fn().mockImplementation(() => {
        callCount++
        return Promise.resolve({ name: `cachedContents/cache-${callCount}` })
      })

      const manager = new GoogleCacheManager(client as any, {
        ...CACHE_DEFAULTS,
        maxEntries: 2,
      })

      // Fill to capacity
      await manager.resolve('gemini-2.5-flash', [block('content-a')])
      await manager.resolve('gemini-2.5-flash', [block('content-b')])

      // This should evict the oldest (content-a)
      await manager.resolve('gemini-2.5-flash', [block('content-c')])

      // content-a should require a new cache creation (4th call)
      const name = await manager.resolve('gemini-2.5-flash', [block('content-a')])
      expect(client.caches.create).toHaveBeenCalledTimes(4) // 3 original + 1 re-creation
      expect(name).toBe('cachedContents/cache-4')
    })
  })

  describe('dispose', () => {
    it('deletes all active caches from the server', async () => {
      const client = createMockClient()
      let callCount = 0
      client.caches.create = vi.fn().mockImplementation(() => {
        callCount++
        return Promise.resolve({ name: `cachedContents/cache-${callCount}` })
      })

      const manager = new GoogleCacheManager(client as any, CACHE_DEFAULTS)
      await manager.resolve('gemini-2.5-flash', [block('content-1')])
      await manager.resolve('gemini-2.5-flash', [block('content-2')])

      await manager.dispose()

      expect(client.caches.delete).toHaveBeenCalledTimes(2)
      expect(client.caches.delete).toHaveBeenCalledWith({ name: 'cachedContents/cache-1' })
      expect(client.caches.delete).toHaveBeenCalledWith({ name: 'cachedContents/cache-2' })

      // After dispose, resolve should create new caches
      await manager.resolve('gemini-2.5-flash', [block('content-1')])
      expect(client.caches.create).toHaveBeenCalledTimes(3)
    })

    it('ignores delete failures gracefully', async () => {
      const client = createMockClient()
      client.caches.delete = vi.fn().mockRejectedValue(new Error('already expired'))
      const manager = new GoogleCacheManager(client as any, CACHE_DEFAULTS)
      await manager.resolve('gemini-2.5-flash', [block('content')])

      // Should not throw
      await expect(manager.dispose()).resolves.toBeUndefined()
    })
  })
})
