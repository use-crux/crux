import { describe, expect, it } from 'vitest'
import { resolveGoogleSystemConfig } from '../system-cache-planner'
import type { GoogleSystemCacheResolver } from '../system-cache-planner'
import type { SystemBlock } from '@crux/core'
import type { GoogleCacheName } from '../cache-types'

describe('resolveGoogleSystemConfig', () => {
  it('returns the plain system instruction when no cache resolver is available', async () => {
    const config = await resolveGoogleSystemConfig({
      model: 'gemini-2.5-flash',
      system: 'Always answer crisply.',
      systemBlocks: [{ source: 'prompt', text: 'Always answer crisply.', providerCache: false }],
    })

    expect(config).toEqual({ systemInstruction: 'Always answer crisply.' })
  })

  it('splits a cacheable prefix into cachedContent and an uncached systemInstruction remainder', async () => {
    const calls: Array<{ readonly model: string; readonly blocks: readonly SystemBlock[] }> = []
    const cacheResolver: GoogleSystemCacheResolver = {
      async resolve(model, blocks) {
        calls.push({ model, blocks })
        return 'cachedContents/stable-prefix' as GoogleCacheName
      },
    }
    const systemBlocks = [
      { source: 'context:rules', text: 'Cached rules', providerCache: true },
      { source: 'context:voice', text: 'Cached voice', providerCache: true },
      { source: 'prompt', text: 'Prompt rules', providerCache: false },
    ] satisfies SystemBlock[]

    const config = await resolveGoogleSystemConfig({
      cacheResolver,
      model: 'gemini-2.5-flash',
      system: 'Cached rules\n\nCached voice\n\nPrompt rules',
      systemBlocks,
    })

    expect(config).toEqual({
      cachedContent: 'cachedContents/stable-prefix',
      systemInstruction: 'Prompt rules',
    })
    expect(calls).toEqual([
      {
        model: 'gemini-2.5-flash',
        blocks: systemBlocks.slice(0, 2),
      },
    ])
  })

  it('returns the plain system instruction and does not resolve a cache when caching is skipped', async () => {
    const calls: string[] = []
    const cacheResolver: GoogleSystemCacheResolver = {
      async resolve(model) {
        calls.push(model)
        return 'cachedContents/unused' as GoogleCacheName
      },
    }

    const config = await resolveGoogleSystemConfig({
      cacheResolver,
      model: 'gemini-2.5-flash',
      system: 'Cached rules',
      systemBlocks: [{ source: 'context:rules', text: 'Cached rules', providerCache: true }],
      cache: { skip: true },
    })

    expect(config).toEqual({ systemInstruction: 'Cached rules' })
    expect(calls).toEqual([])
  })

  it('returns the plain system instruction when the cacheable prefix is empty', async () => {
    const calls: string[] = []
    const cacheResolver: GoogleSystemCacheResolver = {
      async resolve(model) {
        calls.push(model)
        return 'cachedContents/unused' as GoogleCacheName
      },
    }

    const config = await resolveGoogleSystemConfig({
      cacheResolver,
      model: 'gemini-2.5-flash',
      system: 'Prompt rules\n\nLater cached rules',
      systemBlocks: [
        { source: 'prompt', text: 'Prompt rules', providerCache: false },
        { source: 'context:later', text: 'Later cached rules', providerCache: true },
      ],
    })

    expect(config).toEqual({ systemInstruction: 'Prompt rules\n\nLater cached rules' })
    expect(calls).toEqual([])
  })

  it('falls back to the plain system instruction when cache resolution fails', async () => {
    const cacheResolver: GoogleSystemCacheResolver = {
      async resolve() {
        return undefined
      },
    }

    const config = await resolveGoogleSystemConfig({
      cacheResolver,
      model: 'gemini-2.5-flash',
      system: 'Cached rules\n\nPrompt rules',
      systemBlocks: [
        { source: 'context:rules', text: 'Cached rules', providerCache: true },
        { source: 'prompt', text: 'Prompt rules', providerCache: false },
      ],
    })

    expect(config).toEqual({ systemInstruction: 'Cached rules\n\nPrompt rules' })
  })

  it('passes per-call TTL to the cache resolver', async () => {
    const calls: Array<{ readonly ttlSeconds: number | undefined }> = []
    const cacheResolver: GoogleSystemCacheResolver = {
      async resolve(_model, _blocks, options) {
        calls.push({ ttlSeconds: options?.ttlSeconds })
        return 'cachedContents/custom-ttl' as GoogleCacheName
      },
    }

    const config = await resolveGoogleSystemConfig({
      cacheResolver,
      model: 'gemini-2.5-flash',
      system: 'Cached rules',
      systemBlocks: [{ source: 'context:rules', text: 'Cached rules', providerCache: true }],
      cache: { ttlSeconds: 900 },
    })

    expect(config).toEqual({ cachedContent: 'cachedContents/custom-ttl' })
    expect(calls).toEqual([{ ttlSeconds: 900 }])
  })
})
