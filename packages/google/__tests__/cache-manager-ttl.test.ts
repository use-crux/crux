import { describe, expect, it, vi } from 'vitest'
import type { GoogleGenAI } from '@google/genai'
import type { SystemBlock } from '@crux/core'
import { GoogleCacheManager } from '../cache-manager'
import { CACHE_DEFAULTS } from '../cache-types'

function block(text: string): SystemBlock {
  return { source: `context:${text}`, text, providerCache: true }
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

describe('GoogleCacheManager TTL options', () => {
  it('keys otherwise-identical cache entries by TTL', () => {
    const client = createMockClient()
    const manager = new GoogleCacheManager(client as unknown as GoogleGenAI, CACHE_DEFAULTS)

    const key1 = manager.computeKey('gemini-2.5-flash', ['hello'], { ttlSeconds: 60 })
    const key2 = manager.computeKey('gemini-2.5-flash', ['hello'], { ttlSeconds: 600 })

    expect(key1).not.toBe(key2)
  })

  it('uses per-call TTL for cache creation and local expiry', async () => {
    vi.useFakeTimers()
    try {
      const client = createMockClient('cachedContents/custom-ttl')
      const manager = new GoogleCacheManager(client as unknown as GoogleGenAI, CACHE_DEFAULTS)
      const blocks = [block('custom ttl content')]

      const name1 = await manager.resolve('gemini-2.5-flash', blocks, { ttlSeconds: 60 })
      expect(name1).toBe('cachedContents/custom-ttl')
      expect(client.caches.create).toHaveBeenCalledWith({
        model: 'gemini-2.5-flash',
        config: {
          systemInstruction: 'custom ttl content',
          ttl: '60s',
        },
      })

      vi.advanceTimersByTime(61_000)
      client.caches.create.mockResolvedValue({ name: 'cachedContents/custom-ttl-refresh' })

      const name2 = await manager.resolve('gemini-2.5-flash', blocks, { ttlSeconds: 60 })
      expect(name2).toBe('cachedContents/custom-ttl-refresh')
      expect(client.caches.create).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})
