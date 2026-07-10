import { describe, expect, it, vi } from 'vitest'
import type { GoogleGenAI } from '@google/genai'
import { googleSdkCachePort } from '../src/cached-content/sdk-cache-port'
import type { GoogleCacheName } from '../src/cached-content/types'

function fakeClient(create: ReturnType<typeof vi.fn>, del: ReturnType<typeof vi.fn>): GoogleGenAI {
  return { caches: { create, delete: del } } as unknown as GoogleGenAI
}

describe('googleSdkCachePort', () => {
  it('maps create() onto the SDK caches.create payload shape', async () => {
    const create = vi.fn().mockResolvedValue({ name: 'cachedContents/made' })
    const port = googleSdkCachePort(fakeClient(create, vi.fn()))

    const name = await port.create({ model: 'gemini-2.5-flash', systemInstruction: 'Rules', ttlSeconds: 120 })

    expect(name).toBe('cachedContents/made')
    expect(create).toHaveBeenCalledWith({
      model: 'gemini-2.5-flash',
      config: { systemInstruction: 'Rules', ttl: '120s' },
    })
  })

  it('returns undefined when the SDK omits a cache name', async () => {
    const create = vi.fn().mockResolvedValue({})
    const port = googleSdkCachePort(fakeClient(create, vi.fn()))

    const name = await port.create({ model: 'm', systemInstruction: 's', ttlSeconds: 60 })

    expect(name).toBeUndefined()
  })

  it('maps delete() onto the SDK caches.delete payload shape', async () => {
    const del = vi.fn().mockResolvedValue({})
    const port = googleSdkCachePort(fakeClient(vi.fn(), del))

    await port.delete({ name: 'cachedContents/old' as GoogleCacheName })

    expect(del).toHaveBeenCalledWith({ name: 'cachedContents/old' })
  })
})
