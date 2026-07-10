import { describe, expect, it, vi } from 'vitest'
import type { SystemBlock } from '@use-crux/core'
import { createBuiltInCachedContentLifecycle } from '../src/cached-content/built-in-lifecycle'
import { CACHE_DEFAULTS, resolveCacheConfig } from '../src/cached-content/config'
import type { GoogleCacheName, GoogleCachedContentCachePort } from '../src/cached-content/types'

interface FakePort extends GoogleCachedContentCachePort {
  readonly creates: Array<{ model: string; systemInstruction: string; ttlSeconds: number }>
}

function fakePort(create?: GoogleCachedContentCachePort['create']): FakePort {
  const creates: FakePort['creates'] = []
  let n = 0
  return {
    creates,
    create:
      create ??
      (async (input) => {
        creates.push(input)
        n += 1
        return `cachedContents/c-${n}` as GoogleCacheName
      }),
    delete: async () => undefined,
  }
}

const CACHED_PREFIX: SystemBlock[] = [
  { source: 'context:rules', text: 'Cached rules', providerCache: true },
  { source: 'prompt', text: 'Prompt rules', providerCache: false },
]

describe('built-in CachedContent lifecycle', () => {
  it('returns an inline plan with reason "disabled" when caching is off', async () => {
    const lifecycle = createBuiltInCachedContentLifecycle({
      port: fakePort(),
      config: resolveCacheConfig({ enabled: false }),
    })

    const plan = await lifecycle.prepare({ model: 'm', system: 'All of it', systemBlocks: CACHED_PREFIX })

    expect(plan).toEqual({ mode: 'inline', reason: 'disabled', config: { systemInstruction: 'All of it' } })
  })

  it('returns an inline plan with reason "skipped" without touching the port', async () => {
    const port = fakePort()
    const lifecycle = createBuiltInCachedContentLifecycle({ port, config: CACHE_DEFAULTS })

    const plan = await lifecycle.prepare({
      model: 'm',
      system: 'Cached rules\n\nPrompt rules',
      systemBlocks: CACHED_PREFIX,
      call: { skip: true },
    })

    expect(plan).toMatchObject({ mode: 'inline', reason: 'skipped' })
    expect(port.creates).toHaveLength(0)
  })

  it('returns an inline plan with reason "no-cacheable-prefix" when nothing leads with providerCache', async () => {
    const port = fakePort()
    const lifecycle = createBuiltInCachedContentLifecycle({ port, config: CACHE_DEFAULTS })

    const plan = await lifecycle.prepare({
      model: 'm',
      system: 'Prompt only',
      systemBlocks: [{ source: 'prompt', text: 'Prompt only', providerCache: false }],
    })

    expect(plan).toEqual({
      mode: 'inline',
      reason: 'no-cacheable-prefix',
      config: { systemInstruction: 'Prompt only' },
    })
    expect(port.creates).toHaveLength(0)
  })

  it('returns a cached plan splitting the prefix and inline suffix', async () => {
    const port = fakePort()
    const lifecycle = createBuiltInCachedContentLifecycle({ port, config: CACHE_DEFAULTS })

    const plan = await lifecycle.prepare({
      model: 'gemini-2.5-flash',
      system: 'Cached rules\n\nPrompt rules',
      systemBlocks: CACHED_PREFIX,
    })

    expect(plan).toMatchObject({
      mode: 'cached',
      config: { cachedContent: 'cachedContents/c-1', systemInstruction: 'Prompt rules' },
      meta: { ttlSeconds: 300, reused: false },
    })
    expect(port.creates).toEqual([
      { model: 'gemini-2.5-flash', systemInstruction: 'Cached rules', ttlSeconds: 300 },
    ])
  })

  it('omits the inline suffix when the whole prompt is cacheable', async () => {
    const port = fakePort()
    const lifecycle = createBuiltInCachedContentLifecycle({ port, config: CACHE_DEFAULTS })

    const plan = await lifecycle.prepare({
      model: 'm',
      system: 'Cached rules',
      systemBlocks: [{ source: 'context:rules', text: 'Cached rules', providerCache: true }],
    })

    expect(plan.mode).toBe('cached')
    if (plan.mode === 'cached') {
      expect(plan.config.cachedContent).toBe('cachedContents/c-1')
      expect(plan.config.systemInstruction).toBeUndefined()
    }
  })

  it('falls back inline with reason "miss" when the port declines to create', async () => {
    const lifecycle = createBuiltInCachedContentLifecycle({
      port: fakePort(async () => undefined),
      config: CACHE_DEFAULTS,
    })

    const plan = await lifecycle.prepare({
      model: 'm',
      system: 'Cached rules\n\nPrompt rules',
      systemBlocks: CACHED_PREFIX,
    })

    expect(plan).toEqual({
      mode: 'inline',
      reason: 'miss',
      config: { systemInstruction: 'Cached rules\n\nPrompt rules' },
    })
  })

  it('falls back inline with reason "fallback" when a cache operation throws (default policy)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const lifecycle = createBuiltInCachedContentLifecycle({
        port: fakePort(async () => {
          throw new Error('boom')
        }),
        config: CACHE_DEFAULTS,
      })

      const plan = await lifecycle.prepare({
        model: 'm',
        system: 'Cached rules\n\nPrompt rules',
        systemBlocks: CACHED_PREFIX,
      })

      expect(plan).toEqual({
        mode: 'inline',
        reason: 'fallback',
        config: { systemInstruction: 'Cached rules\n\nPrompt rules' },
      })
    } finally {
      warn.mockRestore()
    }
  })

  it('rethrows when onError is "throw"', async () => {
    const lifecycle = createBuiltInCachedContentLifecycle({
      port: fakePort(async () => {
        throw new Error('explode')
      }),
      config: resolveCacheConfig({ onError: 'throw' }),
    })

    await expect(
      lifecycle.prepare({ model: 'm', system: 'Cached rules', systemBlocks: CACHED_PREFIX }),
    ).rejects.toThrow('explode')
  })

  it('uses the per-call TTL override for creation and meta', async () => {
    const port = fakePort()
    const lifecycle = createBuiltInCachedContentLifecycle({ port, config: CACHE_DEFAULTS })

    const plan = await lifecycle.prepare({
      model: 'm',
      system: 'Cached rules',
      systemBlocks: [{ source: 'context:rules', text: 'Cached rules', providerCache: true }],
      call: { ttlSeconds: 900 },
    })

    expect(port.creates[0].ttlSeconds).toBe(900)
    expect(plan.mode === 'cached' && plan.meta?.ttlSeconds).toBe(900)
  })

  it.each([0, -5, Number.NaN, Number.POSITIVE_INFINITY])(
    'ignores an invalid per-call TTL (%s) and uses the default',
    async (ttlSeconds) => {
      const port = fakePort()
      const lifecycle = createBuiltInCachedContentLifecycle({ port, config: CACHE_DEFAULTS })

      const plan = await lifecycle.prepare({
        model: 'm',
        system: 'Cached rules',
        systemBlocks: [{ source: 'context:rules', text: 'Cached rules', providerCache: true }],
        call: { ttlSeconds },
      })

      expect(port.creates[0].ttlSeconds).toBe(CACHE_DEFAULTS.defaultTtlSeconds)
      expect(plan.mode === 'cached' && plan.meta?.ttlSeconds).toBe(CACHE_DEFAULTS.defaultTtlSeconds)
    },
  )

  it('reports reuse on the second prepare with identical inputs', async () => {
    const port = fakePort()
    const lifecycle = createBuiltInCachedContentLifecycle({ port, config: CACHE_DEFAULTS })
    const args = { model: 'm', system: 'Cached rules', systemBlocks: CACHED_PREFIX }

    await lifecycle.prepare(args)
    const second = await lifecycle.prepare(args)

    expect(port.creates).toHaveLength(1)
    expect(second.mode === 'cached' && second.meta?.reused).toBe(true)
  })

  it('delegates dispose to the underlying store', async () => {
    const del = vi.fn().mockResolvedValue(undefined)
    const port: GoogleCachedContentCachePort = {
      create: async () => 'cachedContents/disposable' as GoogleCacheName,
      delete: del,
    }
    const lifecycle = createBuiltInCachedContentLifecycle({ port, config: CACHE_DEFAULTS })
    await lifecycle.prepare({ model: 'm', system: 'Cached rules', systemBlocks: CACHED_PREFIX })

    await lifecycle.dispose?.()

    expect(del).toHaveBeenCalledWith({ name: 'cachedContents/disposable' })
  })
})

describe('resolveCacheConfig validation', () => {
  it('applies defaults for omitted fields', () => {
    expect(resolveCacheConfig()).toEqual(CACHE_DEFAULTS)
  })

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects an invalid defaultTtlSeconds (%s)',
    (defaultTtlSeconds) => {
      expect(() => resolveCacheConfig({ defaultTtlSeconds })).toThrow(/defaultTtlSeconds/)
    },
  )

  it.each([0, -1, 2.5, Number.NaN])('rejects an invalid maxEntries (%s)', (maxEntries) => {
    expect(() => resolveCacheConfig({ maxEntries })).toThrow(/maxEntries/)
  })
})
