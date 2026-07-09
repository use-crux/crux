import { describe, expect, it, vi } from 'vitest'
import type { GoogleGenAI } from '@google/genai'
import type { SystemBlock } from '@use-crux/core'
import { resolveCachedContentLifecycle } from '../src/cached-content/resolve-lifecycle'
import type { GoogleCacheName, GoogleCachedContentCachePort, GoogleCachedContentLifecycle } from '../src/cached-content/types'

function fakeClient() {
  const create = vi.fn().mockResolvedValue({ name: 'cachedContents/sdk' })
  const del = vi.fn().mockResolvedValue({})
  const client = { caches: { create, delete: del } } as unknown as GoogleGenAI
  return { client, create, del }
}

const PREFIX: SystemBlock[] = [{ source: 'context:rules', text: 'Cached rules', providerCache: true }]

describe('resolveCachedContentLifecycle', () => {
  it('disables caching for `false`, never touching the client', async () => {
    const { client, create } = fakeClient()
    const lifecycle = resolveCachedContentLifecycle(client, false)

    const plan = await lifecycle.prepare({ model: 'm', system: 'Cached rules', systemBlocks: PREFIX })

    expect(plan).toEqual({ mode: 'inline', reason: 'disabled', config: { systemInstruction: 'Cached rules' } })
    expect(create).not.toHaveBeenCalled()
  })

  it('builds the SDK-backed lifecycle for plain config', async () => {
    const { client, create } = fakeClient()
    const lifecycle = resolveCachedContentLifecycle(client, { defaultTtlSeconds: 120 })

    const plan = await lifecycle.prepare({ model: 'gemini-2.5-flash', system: 'Cached rules', systemBlocks: PREFIX })

    expect(plan.mode).toBe('cached')
    expect(create).toHaveBeenCalledWith({
      model: 'gemini-2.5-flash',
      config: { systemInstruction: 'Cached rules', ttl: '120s' },
    })
  })

  it('builds the lifecycle for undefined config with defaults', async () => {
    const { client, create } = fakeClient()
    const lifecycle = resolveCachedContentLifecycle(client, undefined)

    await lifecycle.prepare({ model: 'm', system: 'Cached rules', systemBlocks: PREFIX })

    expect(create).toHaveBeenCalledWith({ model: 'm', config: { systemInstruction: 'Cached rules', ttl: '300s' } })
  })

  it('routes create/delete through a custom cache port instead of the client', async () => {
    const { client, create, del } = fakeClient()
    const customCreate = vi.fn(async () => 'cachedContents/custom' as GoogleCacheName)
    const customDelete = vi.fn(async () => undefined)
    const port: GoogleCachedContentCachePort = { create: customCreate, delete: customDelete }

    const lifecycle = resolveCachedContentLifecycle(client, { port })
    const plan = await lifecycle.prepare({ model: 'm', system: 'Cached rules', systemBlocks: PREFIX })

    expect(plan.mode === 'cached' && plan.config.cachedContent).toBe('cachedContents/custom')
    expect(customCreate).toHaveBeenCalledOnce()
    expect(create).not.toHaveBeenCalled()

    await lifecycle.dispose?.()

    expect(customDelete).toHaveBeenCalledWith({ name: 'cachedContents/custom' })
    expect(del).not.toHaveBeenCalled()
  })

  it('returns a user-supplied advanced lifecycle as-is', async () => {
    const { client } = fakeClient()
    const advanced: GoogleCachedContentLifecycle = {
      prepare: vi.fn(async () => ({ mode: 'inline', reason: 'disabled', config: {} }) as const),
    }

    const lifecycle = resolveCachedContentLifecycle(client, advanced)

    expect(lifecycle).toBe(advanced)
  })
})
