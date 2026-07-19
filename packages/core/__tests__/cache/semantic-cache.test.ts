import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { prompt as makePrompt } from '../../src/prompt/prompt'
import { createSemanticCache, semanticCachePolicies } from '../../src/cache'
import { inMemoryStorage } from '../../src/storage'
import { resetHooks } from '../../src/runtime/runtime'
import { orchestrateGenerate, orchestrateStream } from '../../src/generation/orchestrate'
import { textPart } from '../../src/content'
import { resolveQueryText } from '../../src/cache/query'
import { resetObservabilityRuntime } from '../../src/observability'
import {
  createInMemoryObservabilityTransport,
  observe,
  setObservabilityTransport,
} from '../../src/observability'
import { createStreamResult } from '../../src/adapter/result-accumulator'
import {
  cacheablePrompt,
  denseEmbedding,
  installSemanticCachePlugins as install,
  sparseEmbedding,
} from './semantic-cache.fixtures'
import { semanticCacheResultCorrelationCases } from './semantic-cache-result-correlation.cases'

describe('createSemanticCache', () => {
  afterEach(() => {
    resetHooks()
    resetObservabilityRuntime()
    vi.restoreAllMocks()
  })

  semanticCacheResultCorrelationCases()

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
                { type: 'image', source: new Uint8Array([1, 2, 3]), mediaType: 'image/png' },
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
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
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

    const fill = await orchestrateStream(baseSpec, doStream)
    const replayHandle = await orchestrateStream(baseSpec, doStream)
    const replay = createStreamResult(replayHandle)
    const chunks: string[] = []
    for await (const chunk of replay.textStream) chunks.push(chunk)
    const completion = await replay.completion
    await observe.flush()

    const spans = transport.records.filter(
      (record) => record.type === 'span:start' && record.primitive === 'generation.stream',
    )
    const fillSpan = spans[0]
    const replaySpan = spans[1]

    expect(chunks.join('')).toBe('hello stream')
    expect(doStream).toHaveBeenCalledTimes(1)
    expect(fill._meta).toMatchObject({ traceId: fillSpan?.traceId, spanId: fillSpan?.spanId })
    expect(replay._meta).toEqual({ traceId: replaySpan?.traceId, spanId: replaySpan?.spanId })
    expect(replay._meta.traceId).not.toBe(fill._meta.traceId)
    expect(replay._meta.spanId).not.toBe(fill._meta.spanId)
    expect(completion._meta).toMatchObject(replay._meta)
    expect(completion._meta.traceId).not.toBe(fill._meta.traceId)
    expect(completion._meta.spanId).not.toBe(fill._meta.spanId)
  })
})
