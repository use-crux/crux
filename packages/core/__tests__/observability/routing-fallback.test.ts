import { afterEach, describe, expect, it, vi } from 'vitest'
import { fallback, type FallbackModel } from '../../generation/fallback'
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from '../../observability'
import { executeFallbackLoop } from '../../generation/fallback-loop'
import { cascade, router } from '../../routing'
import { resolveModel } from '../../routing/resolve'

function result(text: string, cost = 0.01) {
  return { text, _meta: { cost, usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 } } }
}

const extractModelId = (model: string) => model

describe('canonical routing and fallback observability', () => {
  afterEach(() => {
    resetObservabilityRuntime()
    vi.restoreAllMocks()
  })

    it('records router decisions with selected route metadata', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const routed = router({
      classify: (input) => ((input.big as boolean) ? 'large' : 'small'),
      routes: {
        large: 'model-large',
        small: 'model-small',
        default: 'model-small',
      },
    })
    const tryModel = vi.fn(async (model: string) => result(`from ${model}`))

    await observe.run({ name: 'route request', rootPrimitive: 'routing.router' }, async () => {
      await resolveModel(routed, { big: true }, tryModel, extractModelId)
    })
    await observe.flush()

    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:start',
        primitive: 'routing.router',
        name: 'router.resolve',
        attributes: expect.objectContaining({
          routeCount: 3,
          overridden: false,
          hasHints: false,
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
        preview: expect.objectContaining({
          kind: 'routing.report',
          routingKind: 'router',
          chosen: 'model-large',
          classifiedAs: 'large',
          selectedModel: 'model-large',
          availableRoutes: expect.arrayContaining(['large', 'small', 'default']),
        }),
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

    it('records cascade tiers, rejection, acceptance, and terminal metadata', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const cascaded = cascade({
      tiers: [
        { model: 'model-cheap', evaluate: () => false },
        { model: 'model-strong', evaluate: () => true },
      ],
    })
    const tryModel = vi.fn(async (model: string) => result(`from ${model}`))

    await observe.run({ name: 'cascade request', rootPrimitive: 'routing.cascade' }, async () => {
      await resolveModel(cascaded, {}, tryModel, extractModelId)
    })
    await observe.flush()

    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:start',
        primitive: 'routing.cascade',
        name: 'cascade.resolve',
        attributes: expect.objectContaining({ totalTiers: 2 }),
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
        preview: expect.objectContaining({
          kind: 'routing.report',
          routingKind: 'cascade',
          chosen: 'model-strong',
          tiers: expect.arrayContaining([
            expect.objectContaining({ tier: 0, model: 'model-cheap', verdict: 'rejected' }),
            expect.objectContaining({ tier: 1, model: 'model-strong', verdict: 'accepted' }),
          ]),
        }),
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
          kind: 'routing.report',
          routingKind: 'cascade',
          chosen: 'model-cheap',
          tiers: [
            expect.objectContaining({
              tier: 0,
              model: 'model-cheap',
              verdict: 'accepted',
              confidence: 0.93,
              budget: 0.8,
              note: 'confidence 0.93 >= 0.8',
            }),
            expect.objectContaining({
              tier: 1,
              model: 'model-strong',
              verdict: 'skipped',
              note: 'not reached',
            }),
            expect.objectContaining({
              tier: 2,
              model: 'model-opus',
              verdict: 'skipped',
              note: 'not reached',
              budget: 0.95,
            }),
          ],
        }),
      }),
    )
  })

    it('records fallback attempts with failed and successful model relations', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const fb = fallback('model-a', 'model-b') as FallbackModel<string>
    const tryModel = vi.fn().mockRejectedValueOnce(Object.assign(new Error('rate limited'), { status: 429 }))
    tryModel.mockResolvedValueOnce(result('from model-b'))

    await observe.run({ name: 'fallback request', rootPrimitive: 'fallback.attempt' }, async () => {
      await executeFallbackLoop(fb, tryModel, extractModelId)
    })
    await observe.flush()

    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:start',
        primitive: 'fallback.attempt',
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
          kind: 'routing.report',
          routingKind: 'fallback',
          chosen: 'model-b',
          tiers: expect.arrayContaining([
            expect.objectContaining({ tier: 0, model: 'model-a', verdict: 'error', note: 'rate limited' }),
            expect.objectContaining({ tier: 1, model: 'model-b', verdict: 'success' }),
          ]),
        }),
      }),
    )
  })
})
