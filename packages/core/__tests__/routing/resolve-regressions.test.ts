import { afterEach, describe, expect, it } from 'vitest'
import { cascade, router } from '../../routing'
import { CascadeExhaustedError } from '../../routing/errors'
import { resolveModel } from '../../routing/resolve'
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from '../../observability'

const extractModelId = (model: string) => model

afterEach(() => {
  resetObservabilityRuntime()
})

describe('resolveModel() regressions', () => {
  it.each(['toString', 'constructor'] as const)(
    'treats prototype route key %s as unknown and uses default',
    async (routeKey) => {
      const routed = router({
        classify: () => routeKey as 'known',
        routes: {
          known: 'model-known',
          default: 'model-default',
        },
      })
      const calls: string[] = []

      const result = await resolveModel(
        routed,
        {},
        async (model) => {
          calls.push(model)
          return resultFrom(model)
        },
        extractModelId,
      )

      expect(calls).toEqual(['model-default'])
      expect(result._meta.router).toMatchObject({
        classifiedAs: routeKey,
        selectedModel: 'model-default',
        usedDefaultRoute: true,
      })
    },
  )

  it('ignores unreliable tier costs and still enforces budget from finite costs', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const calls: string[] = []
    const totalCosts: number[] = []
    const costs: Record<string, unknown> = {
      'model-nan': Number.NaN,
      'model-string': '0.01',
      'model-valid': 0.006,
      'model-skipped': 0.02,
    }
    const cascaded = cascade({
      tiers: [
        {
          model: 'model-nan',
          evaluate: (_result, context) => {
            totalCosts.push(context.totalCost)
            return false
          },
        },
        {
          model: 'model-string',
          evaluate: (_result, context) => {
            totalCosts.push(context.totalCost)
            return false
          },
        },
        {
          model: 'model-valid',
          evaluate: (_result, context) => {
            totalCosts.push(context.totalCost)
            return false
          },
        },
        { model: 'model-skipped' },
      ],
      budget: { maxCost: 0.005 },
    })

    const result = await observe.run({ name: 'cascade request', rootPrimitive: 'routing.cascade' }, () =>
      resolveModel(
        cascaded,
        {},
        async (model) => {
          calls.push(model)
          return resultFrom(model, costs[model])
        },
        extractModelId,
      ),
    )
    await observe.flush()

    expect(calls).toEqual(['model-nan', 'model-string', 'model-valid'])
    expect(totalCosts).toEqual([0, 0, 0.006])
    expect(result.text).toBe('response from model-valid')
    expect(result._meta.cascade).toMatchObject({
      acceptedAtTier: 2,
      budgetExceeded: true,
    })
    expect(transport.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'span:event',
          name: 'cascade.cost_unreliable',
          attributes: expect.objectContaining({
            tierIndex: 0,
            model: 'model-nan',
          }),
        }),
        expect.objectContaining({
          type: 'span:event',
          name: 'cascade.cost_unreliable',
          attributes: expect.objectContaining({
            tierIndex: 1,
            model: 'model-string',
          }),
        }),
      ]),
    )
  })

  it('records one cascade span error when all tiers reject', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const cascaded = cascade({
      tiers: [
        { model: 'model-a', evaluate: () => false },
        { model: 'model-b', evaluate: () => false },
      ],
    })

    await expect(
      observe.run({ name: 'cascade request', rootPrimitive: 'routing.cascade' }, () =>
        resolveModel(cascaded, {}, async (model) => resultFrom(model), extractModelId),
      ),
    ).rejects.toThrow(CascadeExhaustedError)
    await observe.flush()

    const cascadeSpanIds: string[] = []
    for (const record of transport.records) {
      if (record.type === 'span:start' && record.name === 'cascade.resolve') {
        cascadeSpanIds.push(record.spanId)
      }
    }
    expect(cascadeSpanIds).toHaveLength(1)

    const cascadeErrorRecords = transport.records.filter(
      (record) => record.type === 'span:end' && record.spanId === cascadeSpanIds[0] && record.status === 'error',
    )
    expect(cascadeErrorRecords).toHaveLength(1)
  })
})

function resultFrom(model: string, cost = 0.001) {
  return {
    text: `response from ${model}`,
    _meta: {
      cost,
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
        inputTokenDetails: {},
        outputTokenDetails: {},
      },
    },
  }
}
