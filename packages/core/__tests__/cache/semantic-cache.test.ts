import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { prompt as makePrompt } from '../../prompt/prompt'
import { createSemanticCache, semanticCachePolicies } from '../../cache'
import { embedding } from '../../embedding'
import { inMemoryStorage } from '../../storage'
import { applyPlugins } from '../../runtime/plugin'
import { getHooks, resetHooks, setHooks } from '../../runtime/runtime'
import { orchestrateGenerate, orchestrateStream } from '../../generation/orchestrate'
import { imagePart, textPart } from '../../content'
import { resolveQueryText } from '../../cache/query'

function denseEmbedding() {
  return embedding({
    kind: 'dense',
    name: 'test-dense',
    dimensions: 3,
    maxInputTokens: 8192,
    batch: { maxSize: 16 },
    embed: async (texts) => ({
      embeddings: texts.map((text) => {
        if (text.includes('billing') || text.includes('invoice')) return [1, 0, 0]
        if (text.includes('refund')) return [0, 1, 0]
        return [0, 0, 1]
      }),
    }),
  })
}

function sparseEmbedding() {
  return embedding({
    kind: 'sparse',
    name: 'test-sparse',
    maxInputTokens: 8192,
    batch: { maxSize: 16 },
    embed: async (texts) => texts.map(() => ({ indices: [1], values: [1] })),
  })
}

function install(plugin: ReturnType<typeof createSemanticCache>) {
  const applied = applyPlugins([plugin], getHooks())
  setHooks(applied.hooks)
  return applied
}

function cacheablePrompt() {
  return makePrompt({
    id: 'intent',
    input: z.object({ message: z.string(), userId: z.string() }),
    output: z.object({ intent: z.string() }),
    cache: { semantic: { version: 'v1', query: ({ input }) => String(input.message) } },
    prompt: ({ input }) => input.message,
  })
}

describe('createSemanticCache', () => {
  afterEach(() => {
    resetHooks()
    vi.restoreAllMocks()
  })

    it('requires a dense embedding', () => {
    expect(() =>
      createSemanticCache({
        storage: inMemoryStorage(),
        embedding: sparseEmbedding() as any,
        ttl: 1000,
        scope: 'global',
      }),
    ).toThrow('requires a dense embedding')
  })

    it('requires ttl', () => {
    expect(() =>
      createSemanticCache({
        storage: inMemoryStorage(),
        embedding: denseEmbedding(),
        ttl: 0,
        scope: 'global',
      }),
    ).toThrow('ttl')
  })

    it('warns when a prompt opts in but no semantic cache plugin is installed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const p = cacheablePrompt()

    await orchestrateGenerate(
      {
        promptId: p.id,
        promptConfig: p.config,
        preparedArgs: {},
        input: { message: 'billing help', userId: 'u1' },
        model: 'mock',
        resolved: await p.resolve({ input: { message: 'billing help', userId: 'u1' } }),
        outputMode: 'object',
      },
      async () => ({ object: { intent: 'billing' }, _meta: { finishReason: 'stop' } }),
    )

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('no createSemanticCache() plugin is installed')
  })

  it('resolves multimodal message queries through the canonical text projection', async () => {
    const query = await resolveQueryText(
      { mode: 'readwrite', version: 'v1' },
      {
        promptId: 'multimodal',
        resolved: {
          messages: [
            {
              role: 'user',
              content: [
                textPart('cache this chart'),
                imagePart({ data: new Uint8Array([1, 2, 3]), mediaType: 'image/png' }),
              ],
            },
          ],
        },
        preparedArgs: {},
      } as never,
    )

    expect(query).toContain('user: cache this chart')
    expect(query).toContain('[image image/png 3B sha256:')
    expect(query).not.toContain('[object Object]')
    expect(query).not.toContain('AQID')
  })

    it('writes on miss and hydrates a cached structured result on semantic hit', async () => {
    const storage = inMemoryStorage()
    install(
      createSemanticCache({
        storage,
        embedding: denseEmbedding(),
        ttl: 60_000,
        scope: ({ input }) => String(input.userId),
      }),
    )

    const p = cacheablePrompt()
    const doGenerate = vi.fn().mockResolvedValue({
      object: { intent: 'billing' },
      text: '{"intent":"billing"}',
      _meta: {
        finishReason: 'stop',
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, inputTokenDetails: {}, outputTokenDetails: {} },
      },
    })

    const first = await orchestrateGenerate(
      {
        promptId: p.id,
        promptConfig: p.config,
        preparedArgs: {},
        input: { message: 'billing help', userId: 'u1' },
        model: 'mock',
        resolved: await p.resolve({ input: { message: 'billing help', userId: 'u1' } }),
        outputMode: 'object',
      },
      doGenerate,
    )
    const second = await orchestrateGenerate(
      {
        promptId: p.id,
        promptConfig: p.config,
        preparedArgs: {},
        input: { message: 'invoice support', userId: 'u1' },
        model: 'mock',
        resolved: await p.resolve({ input: { message: 'invoice support', userId: 'u1' } }),
        outputMode: 'object',
      },
      doGenerate,
    )

    expect(first._meta.semanticCache).toEqual({ hit: false, written: true })
    expect(second.object).toEqual({ intent: 'billing' })
    expect(second._meta.semanticCache.hit).toBe(true)
    expect(doGenerate).toHaveBeenCalledTimes(1)
  })

    it('isolates hits by scope', async () => {
    install(
      createSemanticCache({
        storage: inMemoryStorage(),
        embedding: denseEmbedding(),
        ttl: 60_000,
        scope: ({ input }) => String(input.userId),
      }),
    )
    const p = cacheablePrompt()
    const doGenerate = vi
      .fn()
      .mockResolvedValueOnce({ object: { intent: 'billing' }, _meta: { finishReason: 'stop' } })
      .mockResolvedValueOnce({ object: { intent: 'other-user' }, _meta: { finishReason: 'stop' } })

    for (const userId of ['u1', 'u2']) {
      await orchestrateGenerate(
        {
          promptId: p.id,
          promptConfig: p.config,
          preparedArgs: {},
          input: { message: 'billing help', userId },
          model: 'mock',
          resolved: await p.resolve({ input: { message: 'billing help', userId } }),
          outputMode: 'object',
        },
        doGenerate,
      )
    }

    expect(doGenerate).toHaveBeenCalledTimes(2)
  })

    it('honors shouldCache policies', async () => {
    install(
      createSemanticCache({
        storage: inMemoryStorage(),
        embedding: denseEmbedding(),
        ttl: 60_000,
        scope: 'global',
        shouldCache: semanticCachePolicies.skipWhenToolCallsPresent(),
      }),
    )
    const p = cacheablePrompt()
    const doGenerate = vi.fn().mockResolvedValue({
      text: 'tool result',
      _meta: { finishReason: 'stop', toolCalls: [{ name: 'search', args: {} }] },
    })

    const args = {
      promptId: p.id,
      promptConfig: p.config,
      preparedArgs: {},
      input: { message: 'billing help', userId: 'u1' },
      model: 'mock',
      resolved: await p.resolve({ input: { message: 'billing help', userId: 'u1' } }),
      outputMode: 'text' as const,
    }

    await orchestrateGenerate(args, doGenerate)
    await orchestrateGenerate(args, doGenerate)

    expect(doGenerate).toHaveBeenCalledTimes(2)
  })

    it('returns a synthetic cached stream replay', async () => {
    install(
      createSemanticCache({
        storage: inMemoryStorage(),
        embedding: denseEmbedding(),
        ttl: 60_000,
        scope: 'global',
      }),
    )
    const p = makePrompt({
      id: 'streamer',
      input: z.object({ message: z.string() }),
      cache: { semantic: { query: ({ input }) => String(input.message) } },
      prompt: ({ input }) => input.message,
    })
    const doStream = vi.fn().mockResolvedValue({
      text: 'hello stream',
      _meta: { finishReason: 'stop' },
    })

    const baseSpec = {
      promptId: p.id,
      promptConfig: p.config,
      preparedArgs: {},
      input: { message: 'billing help' },
      model: 'mock',
      resolved: await p.resolve({ input: { message: 'billing help' } }),
      outputMode: 'text' as const,
      createCachedStreamResult: (cached: { text?: string; meta?: Record<string, unknown> }) => ({
        rawStream: (async function* () {
          yield { text: cached.text ?? '' }
        })(),
        extractTextDelta: (chunk: unknown) => (chunk as { text: string }).text,
        completion: async () => cached.meta,
      }),
    }

    await orchestrateStream(baseSpec, doStream)
    const replay = await orchestrateStream(baseSpec, doStream)
    const chunks: string[] = []
    for await (const chunk of replay.rawStream) {
      chunks.push(replay.extractTextDelta(chunk) ?? '')
    }

    expect(chunks.join('')).toBe('hello stream')
    expect(doStream).toHaveBeenCalledTimes(1)
  })
})
