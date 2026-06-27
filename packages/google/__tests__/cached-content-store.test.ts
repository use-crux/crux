import { describe, expect, it, vi } from 'vitest'
import { GoogleCachedContentStore } from '../cached-content/cache-store'
import type { GoogleCacheName, GoogleCachedContentCachePort } from '../cached-content/types'

// ─────────────────────────────────────────────────────────────────
// In-memory cache port
// ─────────────────────────────────────────────────────────────────

interface CreateInput {
  readonly model: string
  readonly systemInstruction: string
  readonly ttlSeconds: number
}

interface FakePort extends GoogleCachedContentCachePort {
  readonly creates: CreateInput[]
  readonly deletes: GoogleCacheName[]
}

function fakePort(
  overrides: Partial<Pick<GoogleCachedContentCachePort, 'create' | 'delete'>> = {},
): FakePort {
  const creates: CreateInput[] = []
  const deletes: GoogleCacheName[] = []
  let counter = 0
  const port: FakePort = {
    creates,
    deletes,
    create:
      overrides.create ??
      (async (input) => {
        creates.push(input)
        counter += 1
        return `cachedContents/cache-${counter}` as GoogleCacheName
      }),
    delete:
      overrides.delete ??
      (async ({ name }) => {
        deletes.push(name)
      }),
  }
  return port
}

const STORE_CONFIG = { defaultTtlSeconds: 300, maxEntries: 50 }

describe('GoogleCachedContentStore', () => {
  it('creates a cache on first resolve and reports it as not reused', async () => {
    const port = fakePort()
    const store = new GoogleCachedContentStore(port, STORE_CONFIG)

    const result = await store.resolve({ model: 'gemini-2.5-flash', texts: ['Cached rules'], ttlSeconds: 300 })

    expect(result?.name).toBe('cachedContents/cache-1')
    expect(result?.reused).toBe(false)
    expect(port.creates).toEqual([
      { model: 'gemini-2.5-flash', systemInstruction: 'Cached rules', ttlSeconds: 300 },
    ])
  })

  it('reuses an active entry on a second resolve with identical inputs', async () => {
    const port = fakePort()
    const store = new GoogleCachedContentStore(port, STORE_CONFIG)
    const input = { model: 'gemini-2.5-flash', texts: ['stable'], ttlSeconds: 300 }

    const first = await store.resolve(input)
    const second = await store.resolve(input)

    expect(first?.name).toBe(second?.name)
    expect(second?.reused).toBe(true)
    expect(port.creates).toHaveLength(1)
  })

  it('joins multiple prefix texts into one system instruction', async () => {
    const port = fakePort()
    const store = new GoogleCachedContentStore(port, STORE_CONFIG)

    await store.resolve({ model: 'gemini-2.5-flash', texts: ['Block A', 'Block B'], ttlSeconds: 300 })

    expect(port.creates[0].systemInstruction).toBe('Block A\n\nBlock B')
  })

  it('deduplicates concurrent resolves for the same content', async () => {
    let release!: (value: { name: string }) => void
    const create = vi.fn().mockReturnValue(
      new Promise<{ name: string }>((resolve) => {
        release = resolve
      }).then((v) => v.name as GoogleCacheName),
    )
    const port = fakePort({ create })
    const store = new GoogleCachedContentStore(port, STORE_CONFIG)
    const input = { model: 'gemini-2.5-flash', texts: ['concurrent'], ttlSeconds: 300 }

    const p1 = store.resolve(input)
    const p2 = store.resolve(input)
    release({ name: 'cachedContents/deduped' })

    const [a, b] = await Promise.all([p1, p2])
    expect(a?.name).toBe('cachedContents/deduped')
    expect(b?.name).toBe('cachedContents/deduped')
    expect(create).toHaveBeenCalledOnce()
  })

  it('recreates a cache after its TTL expires', async () => {
    vi.useFakeTimers()
    try {
      const port = fakePort()
      const store = new GoogleCachedContentStore(port, STORE_CONFIG)
      const input = { model: 'gemini-2.5-flash', texts: ['expiring'], ttlSeconds: 60 }

      const first = await store.resolve(input)
      expect(first?.name).toBe('cachedContents/cache-1')

      vi.advanceTimersByTime(61_000)

      const second = await store.resolve(input)
      expect(second?.name).toBe('cachedContents/cache-2')
      expect(port.creates).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keys otherwise-identical entries by TTL', async () => {
    const port = fakePort()
    const store = new GoogleCachedContentStore(port, STORE_CONFIG)

    await store.resolve({ model: 'gemini-2.5-flash', texts: ['hello'], ttlSeconds: 60 })
    await store.resolve({ model: 'gemini-2.5-flash', texts: ['hello'], ttlSeconds: 600 })

    expect(port.creates).toHaveLength(2)
  })

  it('returns undefined when the port declines to create a cache', async () => {
    const port = fakePort({ create: async () => undefined })
    const store = new GoogleCachedContentStore(port, STORE_CONFIG)

    const result = await store.resolve({ model: 'gemini-2.5-flash', texts: ['tiny'], ttlSeconds: 300 })

    expect(result).toBeUndefined()
  })

  it('propagates errors from the port instead of swallowing them', async () => {
    const port = fakePort({
      create: async () => {
        throw new Error('400 Bad Request')
      },
    })
    const store = new GoogleCachedContentStore(port, STORE_CONFIG)

    await expect(
      store.resolve({ model: 'gemini-2.5-flash', texts: ['boom'], ttlSeconds: 300 }),
    ).rejects.toThrow('400 Bad Request')
  })

  it('retries creation on the next resolve after a failure', async () => {
    let attempts = 0
    const port = fakePort({
      create: async (input) => {
        attempts += 1
        if (attempts === 1) throw new Error('transient')
        return `cachedContents/recovered` as GoogleCacheName
      },
    })
    const store = new GoogleCachedContentStore(port, STORE_CONFIG)
    const input = { model: 'gemini-2.5-flash', texts: ['retry'], ttlSeconds: 300 }

    await expect(store.resolve(input)).rejects.toThrow('transient')
    const result = await store.resolve(input)
    expect(result?.name).toBe('cachedContents/recovered')
  })

  it('evicts the oldest entry when maxEntries is exceeded', async () => {
    const port = fakePort()
    const store = new GoogleCachedContentStore(port, { defaultTtlSeconds: 300, maxEntries: 2 })

    await store.resolve({ model: 'm', texts: ['a'], ttlSeconds: 300 })
    await store.resolve({ model: 'm', texts: ['b'], ttlSeconds: 300 })
    await store.resolve({ model: 'm', texts: ['c'], ttlSeconds: 300 })
    // 'a' was evicted, so resolving it again re-creates (4th create)
    await store.resolve({ model: 'm', texts: ['a'], ttlSeconds: 300 })

    expect(port.creates).toHaveLength(4)
  })

  it('deletes all active caches on dispose and clears tracking', async () => {
    const port = fakePort()
    const store = new GoogleCachedContentStore(port, STORE_CONFIG)
    await store.resolve({ model: 'm', texts: ['one'], ttlSeconds: 300 })
    await store.resolve({ model: 'm', texts: ['two'], ttlSeconds: 300 })

    await store.dispose()

    expect(port.deletes).toEqual(['cachedContents/cache-1', 'cachedContents/cache-2'])

    // After dispose, resolve creates fresh entries again
    await store.resolve({ model: 'm', texts: ['one'], ttlSeconds: 300 })
    expect(port.creates).toHaveLength(3)
  })

  it('ignores delete failures during dispose', async () => {
    const port = fakePort({
      delete: async () => {
        throw new Error('already expired')
      },
    })
    const store = new GoogleCachedContentStore(port, STORE_CONFIG)
    await store.resolve({ model: 'm', texts: ['x'], ttlSeconds: 300 })

    await expect(store.dispose()).resolves.toBeUndefined()
  })
})
