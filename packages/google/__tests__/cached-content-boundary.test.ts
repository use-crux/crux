/**
 * End-to-end CachedContent boundary tests through `createGoogle()`.
 *
 * These exercise the whole lifecycle — prefix extraction, SDK cache creation,
 * inline suffix, per-call controls, and fallback policy — the way a real caller
 * sees it: a fake `GoogleGenAI` client, a Crux prompt, and `generate()` /
 * `stream()`. They are the integration guarantee the RFC asks for, replacing
 * the narrower planner/manager unit tests.
 */
import { describe, expect, it, vi } from 'vitest'
import type { GenerateContentResponse, GoogleGenAI } from '@google/genai'
import { context, prompt } from '@crux/core'
import { createGoogle } from '../index'
import type { GoogleCacheName, GoogleCachedContentCachePort } from '../index'

// ─────────────────────────────────────────────────────────────────
// Fake Google client
// ─────────────────────────────────────────────────────────────────

interface CapturedRequest {
  readonly model: string
  readonly config?: Record<string, unknown>
}

interface GoogleFake {
  readonly calls: CapturedRequest[]
  readonly streams: CapturedRequest[]
  readonly cacheCreates: Array<Record<string, unknown>>
  readonly cacheDeletes: Array<Record<string, unknown>>
  readonly client: GoogleGenAI
}

function createGoogleFake(cacheName = 'cachedContents/boundary'): GoogleFake {
  const calls: CapturedRequest[] = []
  const streams: CapturedRequest[] = []
  const cacheCreates: Array<Record<string, unknown>> = []
  const cacheDeletes: Array<Record<string, unknown>> = []
  const fake = {
    models: {
      generateContent: async (request: CapturedRequest) => {
        calls.push(request)
        return response()
      },
      generateContentStream: async (request: CapturedRequest) => {
        streams.push(request)
        return stream()
      },
    },
    caches: {
      create: async (request: Record<string, unknown>) => {
        cacheCreates.push(request)
        return { name: cacheName }
      },
      delete: async (request: Record<string, unknown>) => {
        cacheDeletes.push(request)
        return {}
      },
    },
  }
  return { calls, streams, cacheCreates, cacheDeletes, client: fake as unknown as GoogleGenAI }
}

function response(): GenerateContentResponse {
  return {
    candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
    text: 'ok',
  } as unknown as GenerateContentResponse
}

async function* stream(): AsyncIterable<GenerateContentResponse> {
  yield response()
}

// ─────────────────────────────────────────────────────────────────
// Cacheable prompt
// ─────────────────────────────────────────────────────────────────

/**
 * A prompt whose leading system block is cacheable and trailing block is not.
 *
 * The cacheable context must lead, so the prompt carries no own `system` text
 * (that would always sort first as an uncacheable `source: 'prompt'` block).
 */
const cachedRules = context({ id: 'rules', system: 'Cached rules', cache: { providerCache: true } })
const promptRules = context({ id: 'extra', system: 'Prompt rules' })
const cachedPrompt = prompt({
  id: 'cached',
  use: [cachedRules, promptRules],
  prompt: 'Hello',
})

const lastConfig = (requests: readonly CapturedRequest[]) => requests.at(-1)?.config

// ─────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────

describe('createGoogle CachedContent boundary', () => {
  it('creates a cache for the prefix and sends the remainder inline on generate()', async () => {
    const fake = createGoogleFake()
    const adapter = createGoogle(fake.client)

    await adapter.generate(cachedPrompt, { model: 'gemini-2.5-flash' })

    expect(fake.cacheCreates).toEqual([
      { model: 'gemini-2.5-flash', config: { systemInstruction: 'Cached rules', ttl: '300s' } },
    ])
    expect(lastConfig(fake.calls)).toMatchObject({
      cachedContent: 'cachedContents/boundary',
      systemInstruction: 'Prompt rules',
    })
  })

  it('reuses the same cache plan across generate() and stream()', async () => {
    const fake = createGoogleFake()
    const adapter = createGoogle(fake.client)

    await adapter.generate(cachedPrompt, { model: 'gemini-2.5-flash' })
    await adapter.stream(cachedPrompt, { model: 'gemini-2.5-flash' })

    // One create shared by both paths.
    expect(fake.cacheCreates).toHaveLength(1)
    expect(lastConfig(fake.streams)).toMatchObject({
      cachedContent: 'cachedContents/boundary',
      systemInstruction: 'Prompt rules',
    })
  })

  it('skips caching for a single call via extra.cachedContent.skip', async () => {
    const fake = createGoogleFake()
    const adapter = createGoogle(fake.client)

    await adapter.generate(cachedPrompt, {
      model: 'gemini-2.5-flash',
      extra: { cachedContent: { skip: true } },
    })

    expect(fake.cacheCreates).toHaveLength(0)
    expect(lastConfig(fake.calls)).toMatchObject({ systemInstruction: 'Cached rules\n\nPrompt rules' })
    expect(lastConfig(fake.calls)).not.toHaveProperty('cachedContent')
  })

  it('honors a per-call TTL override', async () => {
    const fake = createGoogleFake()
    const adapter = createGoogle(fake.client)

    await adapter.generate(cachedPrompt, {
      model: 'gemini-2.5-flash',
      extra: { cachedContent: { ttlSeconds: 900 } },
    })

    expect(fake.cacheCreates[0]).toMatchObject({ config: { ttl: '900s' } })
  })

  it('disables caching entirely with cache: false', async () => {
    const fake = createGoogleFake()
    const adapter = createGoogle(fake.client, { cache: false })

    await adapter.generate(cachedPrompt, { model: 'gemini-2.5-flash' })

    expect(fake.cacheCreates).toHaveLength(0)
    expect(lastConfig(fake.calls)).toMatchObject({ systemInstruction: 'Cached rules\n\nPrompt rules' })
  })

  it('falls back to an inline instruction when cache creation fails (default policy)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const fake = createGoogleFake()
      fake.client.caches.create = (async () => {
        throw new Error('400 min tokens')
      }) as GoogleGenAI['caches']['create']
      const adapter = createGoogle(fake.client)

      await adapter.generate(cachedPrompt, { model: 'gemini-2.5-flash' })

      expect(lastConfig(fake.calls)).toMatchObject({ systemInstruction: 'Cached rules\n\nPrompt rules' })
      expect(lastConfig(fake.calls)).not.toHaveProperty('cachedContent')
    } finally {
      warn.mockRestore()
    }
  })

  it('surfaces cache failures when onError is "throw"', async () => {
    const fake = createGoogleFake()
    fake.client.caches.create = (async () => {
      throw new Error('explode')
    }) as GoogleGenAI['caches']['create']
    const adapter = createGoogle(fake.client, { cache: { onError: 'throw' } })

    await expect(adapter.generate(cachedPrompt, { model: 'gemini-2.5-flash' })).rejects.toThrow('explode')
  })

  it('sends an inline instruction when the SDK returns no cache name (miss)', async () => {
    const fake = createGoogleFake()
    fake.client.caches.create = (async () => ({})) as GoogleGenAI['caches']['create']
    const adapter = createGoogle(fake.client)

    await adapter.generate(cachedPrompt, { model: 'gemini-2.5-flash' })

    expect(lastConfig(fake.calls)).toMatchObject({ systemInstruction: 'Cached rules\n\nPrompt rules' })
    expect(lastConfig(fake.calls)).not.toHaveProperty('cachedContent')
  })

  it('routes cache operations through a custom advanced cache port', async () => {
    const fake = createGoogleFake()
    const create = vi.fn(async () => 'cachedContents/custom-port' as GoogleCacheName)
    const port: GoogleCachedContentCachePort = { create, delete: async () => undefined }
    const adapter = createGoogle(fake.client, { cache: { port } })

    await adapter.generate(cachedPrompt, { model: 'gemini-2.5-flash' })

    expect(create).toHaveBeenCalledOnce()
    expect(fake.cacheCreates).toHaveLength(0)
    expect(lastConfig(fake.calls)).toMatchObject({ cachedContent: 'cachedContents/custom-port' })
  })

  it('delegates entirely to a custom advanced lifecycle', async () => {
    const fake = createGoogleFake()
    const prepare = vi.fn(async () => ({
      mode: 'inline' as const,
      reason: 'disabled' as const,
      config: { systemInstruction: 'From custom lifecycle' },
    }))
    const adapter = createGoogle(fake.client, { cache: { prepare } })

    await adapter.generate(cachedPrompt, { model: 'gemini-2.5-flash' })

    expect(prepare).toHaveBeenCalledOnce()
    expect(fake.cacheCreates).toHaveLength(0)
    expect(lastConfig(fake.calls)).toMatchObject({ systemInstruction: 'From custom lifecycle' })
  })
})
