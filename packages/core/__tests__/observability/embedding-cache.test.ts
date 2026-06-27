import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createSemanticCache } from '../../cache'
import { prompt as makePrompt } from '../../prompt/prompt'
import { embedding, embeddingCache } from '../../embedding'
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from '../../observability'
import { orchestrateGenerate } from '../../generation/orchestrate'
import { applyPlugins } from '../../runtime/plugin'
import { getRuntime, resetRuntime, setRuntime } from '../../runtime/runtime'
import { inMemoryCruxStore } from '../../store'

function install(plugin: ReturnType<typeof createSemanticCache>) {
  const applied = applyPlugins([plugin], getRuntime())
  setRuntime(applied.runtime)
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

describe('canonical embedding and cache observability', () => {
  afterEach(() => {
    resetRuntime()
    resetObservabilityRuntime()
    vi.restoreAllMocks()
  })

  it('records embedding calls with bounded output artifacts and embedding cache hit/miss spans', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const provider = vi.fn(async (texts: string[]) => ({
      embeddings: texts.map((text) => [text.length, text.length + 1]),
      usage: { inputTokens: texts.length, totalTokens: texts.length },
      cost: texts.length * 0.01,
    }))
    const embed = embedding({
      kind: 'dense',
      name: 'cached-dense',
      dimensions: 2,
      maxInputTokens: 100,
      batch: { maxSize: 2 },
      cache: embeddingCache({ store: inMemoryCruxStore(), namespace: 'embeddings' }),
      embed: provider,
    })

    await observe.run({ name: 'embed docs', rootPrimitive: 'embedding.call' }, async () => {
      await expect(embed.embedMany(['alpha', 'beta'])).resolves.toEqual([
        [5, 6],
        [4, 5],
      ])
      await expect(embed.embedMany(['alpha', 'beta'])).resolves.toEqual([
        [5, 6],
        [4, 5],
      ])
    })
    await observe.flush()

    const embeddingStarts = transport.records.filter(
      (record) => record.type === 'span:start' && record.primitive === 'embedding.call',
    )
    expect(embeddingStarts).toHaveLength(2)
    expect(embeddingStarts[0]).toMatchObject({
      family: 'embedding',
      name: 'cached-dense.embedMany',
      attributes: expect.objectContaining({
        embeddingName: 'cached-dense',
        embeddingKind: 'dense',
        operation: 'embedMany',
        inputCount: 2,
        dimensions: 2,
        cacheEnabled: true,
      }),
    })

    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'artifact',
        kind: 'embedding.report',
        attributes: expect.objectContaining({
          primitive: 'embedding.call',
          embeddingName: 'cached-dense',
          embeddingCount: 2,
          dimensions: 2,
        }),
        preview: expect.objectContaining({
          kind: 'embedding.report',
          embeddingName: 'cached-dense',
          embeddingKind: 'dense',
          inputCount: 2,
          chunkCount: 1,
          embeddingCount: 2,
          vectorValuesStored: false,
          dimensions: 2,
        }),
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'artifact',
        kind: 'embedding.report',
        preview: expect.objectContaining({
          kind: 'embedding.report',
          cacheHitCount: 2,
          cacheMissCount: 0,
          cacheHitRatio: 1,
        }),
      }),
    )

    const cacheEnds = transport.records.filter(
      (record) =>
        record.type === 'span:end' &&
        record.status === 'ok' &&
        record.attributes?.cacheKind === 'embedding',
    )
    expect(cacheEnds).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ attributes: expect.objectContaining({ hitCount: 0, missCount: 2, allHit: false }) }),
        expect.objectContaining({ attributes: expect.objectContaining({ hitCount: 2, missCount: 0, allHit: true }) }),
      ]),
    )
    expect(provider).toHaveBeenCalledTimes(1)
  })

  it('records semantic cache lookup, miss, write, and hit decisions as cache.lookup spans', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const store = inMemoryCruxStore()
    const embed = embedding({
      kind: 'dense',
      name: 'semantic-dense',
      dimensions: 3,
      maxInputTokens: 8192,
      batch: { maxSize: 16 },
      embed: async (texts) => ({
        embeddings: texts.map((text) => {
          if (text.includes('billing') || text.includes('invoice')) return [1, 0, 0]
          return [0, 1, 0]
        }),
      }),
    })
    install(
      createSemanticCache({
        store,
        embedding: embed,
        ttl: 60_000,
        scope: ({ input }) => String(input.userId),
      }),
    )

    const p = cacheablePrompt()
    const doGenerate = vi.fn().mockResolvedValue({
      object: { intent: 'billing' },
      text: '{"intent":"billing"}',
      _meta: { finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
    })
    const buildArgs = async (message: string) => ({
      promptId: p.id,
      promptConfig: p.config,
      preparedArgs: {},
      input: { message, userId: 'u1' },
      model: 'mock',
      resolved: await p.resolve({ input: { message, userId: 'u1' } }),
      outputMode: 'object' as const,
    })

    await observe.run({ name: 'semantic cache run', rootPrimitive: 'agent.run' }, async () => {
      await orchestrateGenerate(await buildArgs('billing help'), doGenerate)
      await orchestrateGenerate(await buildArgs('invoice support'), doGenerate)
    })
    await observe.flush()

    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:start',
        primitive: 'cache.lookup',
        name: 'semantic-cache.lookup',
        attributes: expect.objectContaining({
          cacheKind: 'semantic',
          promptId: 'intent',
          operation: 'generate',
          mode: 'readwrite',
        }),
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:event',
        name: 'semantic-cache.miss',
        attributes: expect.objectContaining({ cacheKind: 'semantic' }),
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:start',
        primitive: 'cache.lookup',
        name: 'semantic-cache.write',
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:event',
        name: 'semantic-cache.hit',
        attributes: expect.objectContaining({ cacheKind: 'semantic', score: expect.any(Number) }),
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'artifact',
        kind: 'cache.report',
        preview: expect.objectContaining({
          kind: 'cache.report',
          cacheKind: 'semantic',
          status: 'write',
          event: 'write',
          promptId: 'intent',
        }),
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'artifact',
        kind: 'cache.report',
        preview: expect.objectContaining({
          kind: 'cache.report',
          cacheKind: 'semantic',
          status: 'hit',
          event: 'lookup-hit',
          promptId: 'intent',
        }),
      }),
    )
    expect(doGenerate).toHaveBeenCalledTimes(1)
  })
})
