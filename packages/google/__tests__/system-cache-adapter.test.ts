import { describe, expect, it, vi } from 'vitest'
import type { GenerateContentResponse, GoogleGenAI } from '@google/genai'
import { context, prompt as makePrompt } from '@use-crux/core'
import { createGoogle } from '../index'
import type { GoogleCachedContentPort, GoogleCacheName } from '../index'

interface GoogleFakeRequest {
  readonly model: unknown
  readonly contents?: unknown
  readonly config?: Record<string, unknown>
}

interface GoogleFake {
  readonly calls: GoogleFakeRequest[]
  readonly cacheCreates: GoogleFakeRequest[]
  readonly client: GoogleGenAI
}

describe('Google profile system cache planning', () => {
  it('uses the same cachedContent plan for generate and stream requests', async () => {
    const fake = createGoogleFake()
    const adapter = createGoogle(fake.client)
    const cachedRules = context({ id: 'rules', system: 'Cached rules', cache: { providerCache: true } })
    const promptRules = context({ id: 'prompt-rules', system: 'Prompt rules' })
    const cachedPrompt = makePrompt({
      id: 'google-cache-profile',
      use: [cachedRules, promptRules],
      prompt: 'Hello',
    })

    await adapter.generate(cachedPrompt, { model: 'gemini-2.5-flash' })
    await adapter.stream(cachedPrompt, { model: 'gemini-2.5-flash' })

    expect(fake.cacheCreates).toEqual([
      {
        model: 'gemini-2.5-flash',
        config: { systemInstruction: 'Cached rules', ttl: '300s' },
      },
    ])
    expect(fake.calls.map((call) => call.config)).toEqual([
      expect.objectContaining({ cachedContent: 'cachedContents/shared', systemInstruction: 'Prompt rules' }),
      expect.objectContaining({ cachedContent: 'cachedContents/shared', systemInstruction: 'Prompt rules' }),
    ])
  })

  it('uses the public cachedContent call option for generate and stream requests', async () => {
    const fake = createGoogleFake()
    const adapter = createGoogle(fake.client)
    const cachedRules = context({ id: 'rules-with-ttl', system: 'Cached rules', cache: { providerCache: true } })
    const cachedPrompt = makePrompt({
      id: 'google-cache-call-options',
      use: [cachedRules],
      prompt: 'Hello',
    })

    await adapter.generate(cachedPrompt, {
      model: 'gemini-2.5-flash',
      extra: { cachedContent: { ttlSeconds: 900 } },
    })
    await adapter.stream(cachedPrompt, {
      model: 'gemini-2.5-flash',
      extra: { cachedContent: { ttlSeconds: 900 } },
    })

    expect(fake.cacheCreates).toEqual([
      {
        model: 'gemini-2.5-flash',
        config: { systemInstruction: 'Cached rules', ttl: '900s' },
      },
    ])
    expect(fake.calls.map((call) => call.config)).toEqual([
      expect.objectContaining({ cachedContent: 'cachedContents/shared' }),
      expect.objectContaining({ cachedContent: 'cachedContents/shared' }),
    ])
  })

  it('disables cache management with the public cachedContent option', async () => {
    const fake = createGoogleFake()
    const adapter = createGoogle(fake.client, { cachedContent: false })
    const cachedRules = context({ id: 'disabled-rules', system: 'Cached rules', cache: { providerCache: true } })
    const cachedPrompt = makePrompt({
      id: 'google-cache-disabled',
      use: [cachedRules],
      prompt: 'Hello',
    })

    await adapter.generate(cachedPrompt, { model: 'gemini-2.5-flash' })

    expect(fake.cacheCreates).toEqual([])
    expect(fake.calls[0]?.config).toEqual(expect.objectContaining({ systemInstruction: 'Cached rules' }))
    expect(fake.calls[0]?.config).not.toHaveProperty('cachedContent')
  })

  it('skips cache resolution for a single request', async () => {
    const fake = createGoogleFake()
    const adapter = createGoogle(fake.client)
    const cachedRules = context({ id: 'skip-rules', system: 'Cached rules', cache: { providerCache: true } })
    const cachedPrompt = makePrompt({
      id: 'google-cache-skip',
      use: [cachedRules],
      prompt: 'Hello',
    })

    await adapter.generate(cachedPrompt, {
      model: 'gemini-2.5-flash',
      extra: { cachedContent: { skip: true } },
    })

    expect(fake.cacheCreates).toEqual([])
    expect(fake.calls[0]?.config).toEqual(expect.objectContaining({ systemInstruction: 'Cached rules' }))
    expect(fake.calls[0]?.config).not.toHaveProperty('cachedContent')
  })

  it('falls back to inline system instructions when cache creation fails by default', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const fake = createGoogleFake({ cacheCreateError: new Error('cache quota exceeded') })
      const adapter = createGoogle(fake.client)
      const cachedRules = context({ id: 'fallback-rules', system: 'Cached rules', cache: { providerCache: true } })
      const cachedPrompt = makePrompt({
        id: 'google-cache-fallback',
        use: [cachedRules],
        prompt: 'Hello',
      })

      await adapter.generate(cachedPrompt, { model: 'gemini-2.5-flash' })

      expect(fake.cacheCreates).toHaveLength(1)
      expect(fake.calls[0]?.config).toEqual(expect.objectContaining({ systemInstruction: 'Cached rules' }))
      expect(fake.calls[0]?.config).not.toHaveProperty('cachedContent')
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('propagates cache creation failures when configured to throw', async () => {
    const cacheError = new Error('cache quota exceeded')
    const fake = createGoogleFake({ cacheCreateError: cacheError })
    const adapter = createGoogle(fake.client, { cachedContent: { onError: 'throw' } })
    const cachedRules = context({ id: 'throw-rules', system: 'Cached rules', cache: { providerCache: true } })
    const cachedPrompt = makePrompt({
      id: 'google-cache-throw',
      use: [cachedRules],
      prompt: 'Hello',
    })

    await expect(adapter.generate(cachedPrompt, { model: 'gemini-2.5-flash' })).rejects.toThrow('cache quota exceeded')
    expect(fake.calls).toEqual([])
  })

  it('can resolve cached content through a custom port', async () => {
    const fake = createGoogleFake()
    const resolves: Parameters<GoogleCachedContentPort['resolve']>[0][] = []
    const port = {
      async resolve(args) {
        resolves.push(args)
        return 'cachedContents/custom-port' as GoogleCacheName
      },
    } satisfies GoogleCachedContentPort
    const adapter = createGoogle(fake.client, { cachedContent: port })
    const cachedRules = context({ id: 'port-rules', system: 'Cached rules', cache: { providerCache: true } })
    const promptRules = context({ id: 'port-prompt-rules', system: 'Prompt rules' })
    const cachedPrompt = makePrompt({
      id: 'google-cache-port',
      use: [cachedRules, promptRules],
      prompt: 'Hello',
    })

    await adapter.generate(cachedPrompt, {
      model: 'gemini-2.5-flash',
      extra: { cachedContent: { ttlSeconds: 120 } },
    })

    expect(fake.cacheCreates).toEqual([])
    expect(resolves).toHaveLength(1)
    expect(resolves[0]?.model).toBe('gemini-2.5-flash')
    expect(resolves[0]?.ttlSeconds).toBe(120)
    expect(resolves[0]?.blocks.map(({ source, text, providerCache }) => ({ source, text, providerCache }))).toEqual([
      { source: 'context:port-rules', text: 'Cached rules', providerCache: true },
    ])
    expect(fake.calls[0]?.config).toEqual(
      expect.objectContaining({
        cachedContent: 'cachedContents/custom-port',
        systemInstruction: 'Prompt rules',
      }),
    )
  })

  it('maps Google cached-content usage metadata to Crux cache-read tokens', async () => {
    const fake = createGoogleFake({ response: googleResponse({ cachedContentTokenCount: 80 }) })
    const adapter = createGoogle(fake.client)
    const cachedPrompt = makePrompt({
      id: 'google-cache-usage',
      prompt: 'Hello',
    })

    const result = await adapter.generate(cachedPrompt, { model: 'gemini-2.5-flash' })

    expect(result._meta.usage?.cacheReadTokens).toBe(80)
  })
})

function createGoogleFake(options?: {
  readonly cacheCreateError?: Error
  readonly response?: GenerateContentResponse
}): GoogleFake {
  const calls: GoogleFakeRequest[] = []
  const cacheCreates: GoogleFakeRequest[] = []
  const fake = {
    models: {
      generateContent: async (request: GoogleFakeRequest) => {
        calls.push(request)
        return options?.response ?? googleResponse()
      },
      generateContentStream: async (request: GoogleFakeRequest) => {
        calls.push(request)
        return googleStream()
      },
    },
    caches: {
      create: async (request: GoogleFakeRequest) => {
        cacheCreates.push(request)
        if (options?.cacheCreateError) throw options.cacheCreateError
        return { name: 'cachedContents/shared' }
      },
      delete: async () => ({}),
      get: async () => ({ name: 'cachedContents/shared' }),
      update: async () => ({ name: 'cachedContents/shared' }),
    },
  }
  return { calls, cacheCreates, client: fake as unknown as GoogleGenAI }
}

function googleResponse(options?: { readonly cachedContentTokenCount?: number }): GenerateContentResponse {
  return {
    candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
    usageMetadata: {
      promptTokenCount: 1,
      candidatesTokenCount: 1,
      totalTokenCount: 2,
      ...(options?.cachedContentTokenCount === undefined
        ? {}
        : { cachedContentTokenCount: options.cachedContentTokenCount }),
    },
    text: 'ok',
  } as unknown as GenerateContentResponse
}

async function* googleStream(): AsyncIterable<GenerateContentResponse> {
  yield googleResponse()
}
