import { describe, expect, it } from 'vitest'
import { cascade, fallback, router } from '../../src/routing'
import { CascadeExhaustedError, FallbackExhaustedError } from '../../src/routing/errors'
import { resolveModel } from '../../src/routing/resolve'
import { ensureRoutingResult, withRoutingReceipt } from '../../src/routing/receipt'

const extractModelId = (model: string) => model

describe('RoutingReceipt', () => {
  it('preserves non-enumerable metadata capabilities through normalization and receipts', () => {
    const completion = Promise.resolve({ finishReason: 'stop' })
    const metadata = { responseId: 'response-1' }
    Object.defineProperty(metadata, '_streamCompletion', {
      enumerable: false,
      value: completion,
    })

    const normalized = ensureRoutingResult({ text: 'hello', _meta: metadata })
    const routed = withRoutingReceipt(
      normalized,
      { model: 'model-1', cost: undefined, trace: [] },
    )

    expect(Reflect.get(normalized._meta, '_streamCompletion')).toBe(completion)
    expect(Reflect.get(routed._meta, '_streamCompletion')).toBe(completion)
    expect(Object.keys(routed._meta)).toEqual(['responseId'])
  })

  it('records nested router and fallback decisions as one append-only receipt', async () => {
    const routed = router({
      id: 'intent-router',
      classify: () => 'resilient' as const,
      routes: {
        resilient: fallback(['model-primary', 'model-backup']),
        default: 'model-default',
      },
    })
    const calls: string[] = []

    const result = await resolveModel(
      routed,
      {},
      async (model) => {
        calls.push(model)
        if (model === 'model-primary') {
          const error = new Error('primary unavailable') as Error & { status: number }
          error.status = 500
          throw error
        }
        return resultFrom(model, 0.004)
      },
      extractModelId,
    )

    expect(calls).toEqual(['model-primary', 'model-backup'])
    expect(result.routing).toMatchObject({
      model: 'model-backup',
      cost: 0.004,
      trace: [
        {
          kind: 'router',
          id: 'intent-router',
          classifiedAs: 'resilient',
          route: 'resilient',
          usedDefaultRoute: false,
          forced: false,
        },
        {
          kind: 'fallback',
          attempts: [
            {
              model: 'model-primary',
              status: 'error',
              errorCategory: 'server_error',
              error: 'primary unavailable',
            },
            {
              model: 'model-backup',
              status: 'ok',
              cost: 0.004,
            },
          ],
        },
      ],
    })
    expect(result._meta.router).toBeUndefined()
    expect(result._meta.fallback).toBeUndefined()
  })

  it('records cascade tiers in the same receipt schema', async () => {
    const routed = cascade({
      id: 'quality-cascade',
      tiers: [
        {
          model: 'model-fast',
          evaluate: () => ({
            accepted: false,
            confidence: 0.4,
            budget: 0.8,
            note: 'too weak',
          }),
        },
        { model: 'model-strong' },
      ],
    })

    const result = await resolveModel(
      routed,
      {},
      async (model) => resultFrom(model, model === 'model-fast' ? 0.001 : 0.009),
      extractModelId,
    )

    expect(result.routing).toMatchObject({
      model: 'model-strong',
      cost: 0.01,
      trace: [
        {
          kind: 'cascade',
          id: 'quality-cascade',
          acceptedAtTier: 1,
          budgetExceeded: false,
          tiers: [
            {
              model: 'model-fast',
              status: 'rejected',
              cost: 0.001,
              confidence: 0.4,
              budget: 0.8,
              note: 'too weak',
            },
            {
              model: 'model-strong',
              status: 'accepted',
              cost: 0.009,
            },
          ],
        },
      ],
    })
    expect(result._meta.cascade).toBeUndefined()
  })

  it('throws fallback exhaustion errors with routing receipts', async () => {
    const resilient = fallback(['model-primary', 'model-backup'])

    await expect(
      resolveModel(
        resilient,
        {},
        async (model) => {
          const error = new Error(`${model} unavailable`) as Error & { status: number }
          error.status = 500
          throw error
        },
        extractModelId,
      ),
    ).rejects.toMatchObject({
      name: 'FallbackExhaustedError',
      attempts: [
        { model: 'model-primary', status: 'error', errorCategory: 'server_error' },
        { model: 'model-backup', status: 'error', errorCategory: 'server_error' },
      ],
      routing: {
        model: 'model-backup',
        trace: [
          {
            kind: 'fallback',
            attempts: [
              { model: 'model-primary', status: 'error' },
              { model: 'model-backup', status: 'error' },
            ],
          },
        ],
      },
    })

    await expect(
      resolveModel(
        resilient,
        {},
        async (model) => {
          const error = new Error(`${model} unavailable`) as Error & { status: number }
          error.status = 500
          throw error
        },
        extractModelId,
      ),
    ).rejects.toBeInstanceOf(FallbackExhaustedError)
  })

  it('throws cascade exhaustion errors with routing receipts', async () => {
    const routed = cascade({
      id: 'exhausting-cascade',
      tiers: [
        { model: 'model-fast', evaluate: () => false },
        { model: 'model-strong', evaluate: () => false },
      ],
    })

    await expect(
      resolveModel(
        routed,
        {},
        async (model) => resultFrom(model, 0.002),
        extractModelId,
      ),
    ).rejects.toMatchObject({
      name: 'CascadeExhaustedError',
      routing: {
        model: 'model-strong',
        trace: [
          {
            kind: 'cascade',
            id: 'exhausting-cascade',
            acceptedAtTier: -1,
            budgetExceeded: false,
            tiers: [
              { model: 'model-fast', status: 'rejected' },
              { model: 'model-strong', status: 'rejected' },
            ],
          },
        ],
      },
    })

    await expect(
      resolveModel(
        routed,
        {},
        async (model) => resultFrom(model, 0.002),
        extractModelId,
      ),
    ).rejects.toBeInstanceOf(CascadeExhaustedError)
  })
})

function resultFrom(model: string, cost: number) {
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
