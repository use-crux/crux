import { afterEach, describe, expect, it, vi } from 'vitest'
import { fallback, type FallbackModel } from '../../generation/fallback'
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from '../../observability'
import { cascade, fallback as routedFallback, retry, router, split } from '../../routing'
import { resolveModel } from '../../routing/resolve'

function result(text: string, cost = 0.01) {
  return {
    text,
    _meta: { cost, usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3, inputTokenDetails: {}, outputTokenDetails: {} } },
  }
}

const extractModelId = (model: string) => model
const resolveFallback = (
  fb: FallbackModel<string>,
  tryModel: (model: string, options?: { signal?: AbortSignal }) => Promise<ReturnType<typeof result>>,
) => resolveModel(fb, {}, tryModel, extractModelId)

describe('canonical routing and fallback observability', () => {
  afterEach(() => {
    resetObservabilityRuntime()
    vi.restoreAllMocks()
  })

  it('records router decisions with the canonical routing receipt artifact', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const routed = router({
      classify: ({ input }: { input: { big?: boolean }; context: object }) =>
        input.big ? 'large' : 'small',
      routes: {
        large: 'model-large',
        small: 'model-small',
        default: 'model-small',
      },
    })
    const tryModel = vi.fn(async (model: string) => result(`from ${model}`))
    let resolved: Awaited<ReturnType<typeof resolveModel<string, ReturnType<typeof result>>>> | undefined

    await observe.run({ name: 'route request', rootPrimitive: 'routing.router' }, async () => {
      resolved = await resolveModel(routed, { big: true }, tryModel, extractModelId)
    })
    await observe.flush()

    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:start',
        primitive: 'routing.router',
        name: 'router.resolve',
        attributes: expect.objectContaining({
          routingKind: 'router',
          deadlineRemainingMs: null,
          routeCount: 3,
          overridden: false,
        }),
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:event',
        name: 'router.selected',
        attributes: expect.objectContaining({
          classifiedAs: 'large',
          selectedModel: 'model-large',
          usedDefaultRoute: false,
        }),
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'artifact',
        kind: 'routing.report',
        preview: resolved?.routing,
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:end',
        status: 'ok',
        attributes: expect.objectContaining({
          classifiedAs: 'large',
          selectedModel: 'model-large',
        }),
      }),
    )
  })

  it('records cascade tiers through the canonical routing receipt artifact', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const cascaded = cascade({
      tiers: [
        { model: 'model-cheap', evaluate: () => false },
        { model: 'model-strong', evaluate: () => true },
      ],
    })
    const tryModel = vi.fn(async (model: string) => result(`from ${model}`))
    let resolved: Awaited<ReturnType<typeof resolveModel<string, ReturnType<typeof result>>>> | undefined

    await observe.run({ name: 'cascade request', rootPrimitive: 'routing.cascade' }, async () => {
      resolved = await resolveModel(cascaded, {}, tryModel, extractModelId)
    })
    await observe.flush()

    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:start',
        primitive: 'routing.cascade',
        name: 'cascade.resolve',
        attributes: expect.objectContaining({
          routingKind: 'cascade',
          deadlineRemainingMs: null,
          totalTiers: 2,
        }),
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:start',
        primitive: 'routing.cascade',
        name: 'cascade.tier',
        attributes: expect.objectContaining({ tierIndex: 0, model: 'model-cheap' }),
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:end',
        status: 'ok',
        attributes: expect.objectContaining({ tierIndex: 0, model: 'model-cheap', tierStatus: 'rejected' }),
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:end',
        status: 'ok',
        attributes: expect.objectContaining({
          totalTiers: 2,
          tiersAttempted: 2,
          acceptedAtTier: 1,
          budgetExceeded: false,
        }),
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'artifact',
        kind: 'routing.report',
        preview: resolved?.routing,
      }),
    )
  })

    it('records full cascade ladder and structured evaluation notes', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const cascaded = cascade({
      tiers: [
        {
          model: 'model-cheap',
          evaluate: () => ({ accepted: true, confidence: 0.93, budget: 0.8 }),
        },
        { model: 'model-strong' },
        { model: 'model-opus', budget: 0.95 },
      ],
    })
    const tryModel = vi.fn(async (model: string) => result(`from ${model}`))

    await observe.run({ name: 'cascade request', rootPrimitive: 'routing.cascade' }, async () => {
      await resolveModel(cascaded, {}, tryModel, extractModelId)
    })
    await observe.flush()

    expect(tryModel).toHaveBeenCalledTimes(1)
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'artifact',
        kind: 'routing.report',
        preview: expect.objectContaining({
          model: 'model-cheap',
          trace: [
            expect.objectContaining({
              kind: 'cascade',
              tiers: [
                expect.objectContaining({
                  model: 'model-cheap',
                  status: 'accepted',
                  confidence: 0.93,
                  budget: 0.8,
                  note: 'confidence 0.93 >= 0.8',
                }),
                expect.objectContaining({
                  model: 'model-strong',
                  status: 'skipped',
                  note: 'not reached',
                }),
                expect.objectContaining({
                  model: 'model-opus',
                  status: 'skipped',
                  note: 'not reached',
                  budget: 0.95,
                }),
              ],
            }),
          ],
        }),
      }),
    )
  })

  it('emits exactly one receipt artifact for nested router to fallback resolution', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const routed = router({
      classify: () => 'resilient' as const,
      routes: {
        resilient: routedFallback(['model-a', 'model-b']),
        default: 'model-b',
      },
    })
    const tryModel = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('rate limited'), { status: 429 }))
      .mockResolvedValueOnce(result('from model-b'))
    let resolved: Awaited<ReturnType<typeof resolveModel<string, ReturnType<typeof result>>>> | undefined

    await observe.run({ name: 'nested route request', rootPrimitive: 'routing.router' }, async () => {
      resolved = await resolveModel(routed, {}, tryModel, extractModelId)
    })
    await observe.flush()

    const artifacts = transport.records.filter(
      (record) => record.type === 'artifact' && record.kind === 'routing.report',
    )
    expect(artifacts).toHaveLength(1)
    expect(artifacts[0]).toEqual(
      expect.objectContaining({ preview: resolved?.routing }),
    )
    expect(artifacts[0]).not.toHaveProperty('preview.kind')
    expect(resolved?.routing?.trace.map((step) => step.kind)).toEqual([
      'router',
      'fallback',
    ])
  })

  it('adds shared routing attributes to every routing primitive span', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const tryModel = vi.fn(async (model: string) => result(`from ${model}`))

    await observe.run({ name: 'routing attributes', rootPrimitive: 'routing.router' }, async () => {
      await resolveModel(
        router({
          classify: () => 'default' as const,
          routes: { default: 'router-model' },
        }),
        {},
        tryModel,
        extractModelId,
      )
      await resolveModel(
        split({
          seed: () => 'session-1',
          routes: { a: { model: 'split-model', weight: 1 } },
        }),
        {},
        tryModel,
        extractModelId,
      )
      await resolveModel(retry('retry-model', { attempts: 1 }), {}, tryModel, extractModelId)
      await resolveModel(routedFallback(['fallback-model', 'fallback-backup']), {}, tryModel, extractModelId)
      await resolveModel(
        cascade({ tiers: [{ model: 'cascade-model' }] }),
        {},
        tryModel,
        extractModelId,
      )
    })
    await observe.flush()

    for (const [primitive, routingKind] of [
      ['routing.router', 'router'],
      ['routing.split', 'split'],
      ['routing.retry', 'retry'],
      ['routing.fallback', 'fallback'],
      ['routing.cascade', 'cascade'],
    ] as const) {
      expect(transport.records).toContainEqual(
        expect.objectContaining({
          type: 'span:start',
          primitive,
          attributes: expect.objectContaining({
            routingKind,
            deadlineRemainingMs: null,
          }),
        }),
      )
    }
  })

    it('records fallback attempts with failed and successful model relations', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const fb = fallback(['model-a', 'model-b']) as FallbackModel<string>
    const tryModel = vi.fn().mockRejectedValueOnce(Object.assign(new Error('rate limited'), { status: 429 }))
    tryModel.mockResolvedValueOnce(result('from model-b'))

    await observe.run({ name: 'fallback request', rootPrimitive: 'routing.fallback' }, async () => {
      await resolveFallback(fb, tryModel)
    })
    await observe.flush()

    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:start',
        primitive: 'routing.fallback',
        name: 'fallback.attempt',
        attributes: expect.objectContaining({ attempt: 1, model: 'model-a', totalModels: 2 }),
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:end',
        status: 'error',
        attributes: expect.objectContaining({
          attempt: 1,
          model: 'model-a',
          errorCategory: 'rate_limit',
          willAttemptFallback: true,
        }),
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:end',
        status: 'ok',
        attributes: expect.objectContaining({ attempt: 2, model: 'model-b', attemptStatus: 'success' }),
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'edge',
        edgeType: 'fallback.attempt',
        attributes: expect.objectContaining({ fromModel: 'model-a', toModel: 'model-b' }),
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'artifact',
        kind: 'routing.report',
        preview: expect.objectContaining({
          model: 'model-b',
          trace: [
            expect.objectContaining({
              kind: 'fallback',
              attempts: [
                expect.objectContaining({ model: 'model-a', status: 'error', error: 'rate limited' }),
                expect.objectContaining({ model: 'model-b', status: 'ok' }),
              ],
            }),
          ],
        }),
      }),
    )
  })

    it('records fallback hook errors on the active attempt span', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const providerError = Object.assign(new Error('rate limited'), { status: 429 })
    const fb = fallback(['model-a', 'model-b'], {
      shouldFallback: () => {
        throw new Error('predicate failed')
      },
    }) as FallbackModel<string>
    const tryModel = vi.fn().mockRejectedValueOnce(providerError)

    await observe.run({ name: 'fallback request', rootPrimitive: 'routing.fallback' }, async () => {
      await expect(resolveFallback(fb, tryModel)).rejects.toBe(providerError)
    })
    await observe.flush()

    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:event',
        name: 'routing.hook_error',
        attributes: expect.objectContaining({
          routingKind: 'fallback',
          hook: 'shouldFallback',
          error: 'predicate failed',
        }),
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:end',
        status: 'error',
        attributes: expect.objectContaining({
          model: 'model-a',
          willAttemptFallback: false,
        }),
      }),
    )
  })
})
