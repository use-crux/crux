import { expect, it, vi } from 'vitest'

import { createSemanticCache } from '../../src/cache'
import type { SemanticCacheEntry } from '../../src/cache/types'
import { orchestrateGenerate } from '../../src/generation/orchestrate'
import type { CruxPlugin } from '../../src/runtime/plugin'
import { inMemoryStorage, type JsonObject } from '../../src/storage'
import {
  createInMemoryObservabilityTransport,
  createCruxSpanId,
  createCruxTraceId,
  observe,
  setObservabilityTransport,
} from '../../src/observability'
import {
  cacheablePrompt,
  denseEmbedding,
  installSemanticCachePlugins,
} from './semantic-cache.fixtures'

/** Register semantic-cache result-correlation contracts in the parent suite. */
export function semanticCacheResultCorrelationCases(): void {
  it('stores no invocation IDs and hydrates a hit with the current call pair', async () => {
    const storage = inMemoryStorage()
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const putRecord = vi.spyOn(storage.records, 'put')
    installSemanticCachePlugins(cachePlugin(storage))
    const prompt = cacheablePrompt()
    const doGenerate = vi.fn().mockResolvedValue(providerResult())

    const first = await orchestrateGenerate(
      await generationSpec(prompt, 'billing help'),
      doGenerate,
    )
    const second = await orchestrateGenerate(
      await generationSpec(prompt, 'invoice support'),
      doGenerate,
    )
    await observe.flush()
    const currentSpan = generationCallSpans(transport.records).at(-1)

    expect(first._meta).toMatchObject({
      traceId: expect.any(String),
      spanId: expect.any(String),
      semanticCache: { hit: false, written: true },
      responseId: 'provider-response',
      actualModelId: 'provider-model',
      constraints: { passed: true },
    })
    const stored = putRecord.mock.calls[0]?.[1] as unknown as SemanticCacheEntry
    expect(stored.result.meta).toMatchObject({
      responseId: 'provider-response',
      actualModelId: 'provider-model',
      constraints: { passed: true },
    })
    expect(stored.result.meta).not.toHaveProperty('traceId')
    expect(stored.result.meta).not.toHaveProperty('spanId')
    expect(second).toMatchObject({
      object: { intent: 'billing' },
      _meta: {
        responseId: 'provider-response',
        actualModelId: 'provider-model',
        constraints: { passed: true },
        semanticCache: { hit: true },
      },
    })
    expect(second._meta.traceId).not.toBe(first._meta.traceId)
    expect(second._meta.spanId).not.toBe(first._meta.spanId)
    expect(second._meta.traceId).toBe(currentSpan?.traceId)
    expect(second._meta.spanId).toBe(currentSpan?.spanId)
    expect(doGenerate).toHaveBeenCalledTimes(1)
  })

  it('adds miss facts without mutating a frozen provider result', async () => {
    installSemanticCachePlugins(cachePlugin(inMemoryStorage()))
    const prompt = cacheablePrompt()
    const frozenMeta = Object.freeze({
      finishReason: 'stop',
      responseId: 'frozen-response',
    })
    const frozenPayload = Object.freeze({
      object: { intent: 'billing' },
      _meta: frozenMeta,
    })

    const result = await orchestrateGenerate(
      await generationSpec(prompt, 'billing help'),
      async () => frozenPayload,
    )

    expect(result).not.toBe(frozenPayload)
    expect(result._meta).toMatchObject({
      responseId: 'frozen-response',
      traceId: expect.any(String),
      spanId: expect.any(String),
      semanticCache: { hit: false, written: true },
    })
    expect(frozenMeta).toEqual({
      finishReason: 'stop',
      responseId: 'frozen-response',
    })
  })

  it('overwrites forged IDs from a legacy entry before an outer layer sees the hit', async () => {
    const storage = inMemoryStorage()
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    let outerResult: Record<string, unknown> | undefined
    const observer: CruxPlugin = {
      name: 'legacy-cache-result-observer',
      install: () => ({
        middleware: async (args, next) => {
          const result = await next(args)
          outerResult = result
          return result
        },
      }),
    }
    installSemanticCachePlugins(cachePlugin(storage), observer)
    const prompt = cacheablePrompt()
    const doGenerate = vi.fn().mockResolvedValue(providerResult())

    const first = await orchestrateGenerate(
      await generationSpec(prompt, 'billing help'),
      doGenerate,
    )
    const page = await storage.records.list('crux:semantic-cache:')
    const stored = page.entries[0]
    expect(stored).toBeDefined()
    const entry = stored?.value as unknown as SemanticCacheEntry
    const forged = {
      traceId: createCruxTraceId(),
      spanId: createCruxSpanId(),
    }
    await storage.records.put(
      stored?.key ?? 'missing-cache-entry',
      {
        ...entry,
        result: {
          ...entry.result,
          meta: { ...entry.result.meta, ...forged },
        },
      } as unknown as JsonObject,
      { ttlMs: 60_000 },
    )

    const second = await orchestrateGenerate(
      await generationSpec(prompt, 'invoice support'),
      doGenerate,
    )
    await observe.flush()
    const currentSpan = generationCallSpans(transport.records).at(-1)

    expect(outerResult).toMatchObject({
      _meta: {
        responseId: 'provider-response',
        traceId: second._meta.traceId,
        spanId: second._meta.spanId,
      },
    })
    expect(second._meta.traceId).not.toBe(forged.traceId)
    expect(second._meta.spanId).not.toBe(forged.spanId)
    expect(second._meta.traceId).not.toBe(first._meta.traceId)
    expect(second._meta.traceId).toBe(currentSpan?.traceId)
    expect(second._meta.spanId).toBe(currentSpan?.spanId)
    expect(doGenerate).toHaveBeenCalledTimes(1)
  })
}

function generationCallSpans(
  records: readonly { type: string; primitive?: string }[],
) {
  return records.filter(
    (record) =>
      record.type === 'span:start' && record.primitive === 'generation.call',
  ) as Array<
    (typeof records)[number] & { traceId: string; spanId: string }
  >
}

function cachePlugin(storage: ReturnType<typeof inMemoryStorage>) {
  return createSemanticCache({
    storage,
    embedding: denseEmbedding(),
    ttl: 60_000,
    scope: ({ input }) => String(input.userId),
  })
}

function providerResult() {
  return {
    object: { intent: 'billing' },
    text: '{"intent":"billing"}',
    _meta: {
      finishReason: 'stop',
      responseId: 'provider-response',
      actualModelId: 'provider-model',
      constraints: { passed: true },
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
        inputTokenDetails: {},
        outputTokenDetails: {},
      },
    },
  }
}

async function generationSpec(
  prompt: ReturnType<typeof cacheablePrompt>,
  message: string,
) {
  const input = { message, userId: 'u1' }
  return {
    promptId: prompt.id,
    promptConfig: prompt.config,
    preparedArgs: {},
    input,
    model: 'mock',
    resolved: await prompt.resolve({ input }),
    outputMode: 'object' as const,
  }
}
