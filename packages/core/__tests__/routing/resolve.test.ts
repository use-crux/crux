import { describe, it, expect, vi } from 'vitest'
import { router, cascade } from '../../routing'
import { resolveModel } from '../../routing/resolve'
import { fallback } from '../../generation/fallback'
import { CascadeExhaustedError } from '../../routing/errors'

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

/** Fake generate that returns a result with _meta. */
function fakeGenerate(model: string, opts?: { cost?: number }) {
  return {
    text: `response from ${model}`,
    object: { quality: 0.9 },
    _meta: {
      cost: opts?.cost ?? 0.001,
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, inputTokenDetails: {}, outputTokenDetails: {} },
    },
  }
}

/** Creates a tryModel callback that tracks calls and returns fakeGenerate results. */
function createTryModel(costByModel?: Record<string, number>) {
  const calls: string[] = []
  const tryModel = async (model: string) => {
    calls.push(model)
    return fakeGenerate(model, { cost: costByModel?.[model] })
  }
  return { tryModel, calls }
}

const extractModelId = (m: string) => m

// ─────────────────────────────────────────────────────────────────
// Raw model passthrough
// ─────────────────────────────────────────────────────────────────

describe('resolveModel() — raw model', () => {
  it('passes raw model through unchanged', async () => {
    const { tryModel, calls } = createTryModel()

    const result = await resolveModel('raw-model', {}, tryModel, extractModelId)

    expect(calls).toEqual(['raw-model'])
    expect(result.text).toBe('response from raw-model')
  })
})

// ─────────────────────────────────────────────────────────────────
// Router
// ─────────────────────────────────────────────────────────────────

describe('resolveModel() — router', () => {
  it('classifies input and selects the matched model', async () => {
    const r = router({
      id: 'size-router',
      classify: (input) => ((input as any).big ? 'large' : 'small'),
      routes: {
        large: 'model-large',
        small: 'model-small',
        default: 'model-small',
      },
    })

    const { tryModel, calls } = createTryModel()
    const result = await resolveModel(r, { big: true }, tryModel, extractModelId)

    expect(calls).toEqual(['model-large'])
    expect(result._meta.router).toMatchObject({
      routingId: 'size-router',
      classifiedAs: 'large',
      selectedModel: 'model-large',
      overridden: false,
    })
  })

    it('falls to default when classify returns unknown key', async () => {
    const r = router({
      classify: () => 'nonexistent' as any,
      routes: {
        known: 'model-known',
        default: 'model-default',
      },
    })

    const { tryModel, calls } = createTryModel()
    const result = await resolveModel(r, {}, tryModel, extractModelId)

    expect(calls).toEqual(['model-default'])
    expect(result._meta.router.classifiedAs).toBe('nonexistent')
    expect(result._meta.router.selectedModel).toBe('model-default')
  })

    it('uses forced route from .select(), skipping classify', async () => {
    const classify = vi.fn(() => 'a' as const)
    const r = router({
      classify,
      routes: { a: 'model-a', b: 'model-b', default: 'model-a' },
    })

    const { tryModel, calls } = createTryModel()
    const result = await resolveModel(r.select('b'), {}, tryModel, extractModelId)

    expect(classify).not.toHaveBeenCalled()
    expect(calls).toEqual(['model-b'])
    expect(result._meta.router).toMatchObject({
      classifiedAs: 'b',
      selectedModel: 'model-b',
      overridden: true,
    })
  })

    it('passes hints from .with() to classify', async () => {
    const classify = vi.fn((_input: Record<string, unknown>, hints?: { cheap?: boolean }) => {
      return hints?.cheap ? 'budget' : 'premium'
    })
    const r = router({
      classify,
      routes: { budget: 'model-cheap', premium: 'model-expensive', default: 'model-expensive' },
    })

    const { tryModel, calls } = createTryModel()
    const result = await resolveModel(r.with({ cheap: true }), {}, tryModel, extractModelId)

    expect(classify).toHaveBeenCalledWith({}, { cheap: true })
    expect(calls).toEqual(['model-cheap'])
    expect(result._meta.router.hints).toEqual({ cheap: true })
  })

    it('supports async classify', async () => {
    const r = router({
      classify: async (input) => {
        await new Promise((r) => setTimeout(r, 1))
        return (input as any).size > 100 ? 'big' : 'small'
      },
      routes: { big: 'model-big', small: 'model-small', default: 'model-small' },
    })

    const { tryModel, calls } = createTryModel()
    await resolveModel(r, { size: 200 }, tryModel, extractModelId)

    expect(calls).toEqual(['model-big'])
  })
})

// ─────────────────────────────────────────────────────────────────
// Cascade
// ─────────────────────────────────────────────────────────────────

describe('resolveModel() — cascade', () => {
  it('accepts first tier when evaluate returns true', async () => {
    const c = cascade({
      tiers: [{ model: 'model-cheap', evaluate: () => true }, { model: 'model-expensive' }],
    })

    const { tryModel, calls } = createTryModel()
    const result = await resolveModel(c, {}, tryModel, extractModelId)

    expect(calls).toEqual(['model-cheap'])
    expect(result._meta.cascade).toMatchObject({
      tiersAttempted: 1,
      totalTiers: 2,
      acceptedAtTier: 0,
      budgetExceeded: false,
      tiers: [
        expect.objectContaining({ model: 'model-cheap', status: 'accepted' }),
        expect.objectContaining({ model: 'model-expensive', status: 'skipped', note: 'not reached' }),
      ],
    })
  })

    it('escalates to next tier when evaluate returns false', async () => {
    const c = cascade({
      tiers: [
        { model: 'model-cheap', evaluate: () => false },
        { model: 'model-mid', evaluate: () => true },
        { model: 'model-expensive' },
      ],
    })

    const { tryModel, calls } = createTryModel()
    const result = await resolveModel(c, {}, tryModel, extractModelId)

    expect(calls).toEqual(['model-cheap', 'model-mid'])
    expect(result._meta.cascade).toMatchObject({
      tiersAttempted: 2,
      acceptedAtTier: 1,
    })
    expect(result._meta.cascade.tiers[0].status).toBe('rejected')
    expect(result._meta.cascade.tiers[1].status).toBe('accepted')
  })

    it('last tier without evaluate always accepts', async () => {
    const c = cascade({
      tiers: [
        { model: 'model-cheap', evaluate: () => false },
        { model: 'model-expensive' }, // no evaluate
      ],
    })

    const { tryModel, calls } = createTryModel()
    const result = await resolveModel(c, {}, tryModel, extractModelId)

    expect(calls).toEqual(['model-cheap', 'model-expensive'])
    expect(result._meta.cascade.acceptedAtTier).toBe(1)
  })

    it('throws CascadeExhaustedError when all tiers fail evaluation', async () => {
    const c = cascade({
      tiers: [
        { model: 'model-a', evaluate: () => false },
        { model: 'model-b', evaluate: () => false },
      ],
    })

    const { tryModel } = createTryModel()

    await expect(resolveModel(c, {}, tryModel, extractModelId)).rejects.toThrow(CascadeExhaustedError)
  })

    it('returns last result with budgetExceeded when cost exceeds maxCost', async () => {
    const c = cascade({
      tiers: [{ model: 'model-cheap', evaluate: () => false }, { model: 'model-expensive' }],
      budget: { maxCost: 0.005 },
    })

    // model-cheap costs 0.006 — exceeds budget after tier 1
    // tier 2 is skipped, model-cheap result returned with budgetExceeded
    const { tryModel } = createTryModel({ 'model-cheap': 0.006, 'model-expensive': 0.01 })
    const result = await resolveModel(c, {}, tryModel, extractModelId)

    expect(result._meta.cascade.budgetExceeded).toBe(true)
    expect(result.text).toBe('response from model-cheap')
  })

    it('returns last result with budgetExceeded when latency exceeds maxLatencyMs', async () => {
    const c = cascade({
      tiers: [
        {
          model: 'model-cheap',
          evaluate: () => false,
        },
        { model: 'model-expensive' },
      ],
      budget: { maxLatencyMs: 1 }, // 1ms — will be exceeded
    })

    // Slow tryModel for first tier
    const calls: string[] = []
    const tryModel = async (model: string) => {
      calls.push(model)
      await new Promise((r) => setTimeout(r, 10)) // 10ms > 1ms budget
      return fakeGenerate(model)
    }

    const result = await resolveModel(c, {}, tryModel, extractModelId)

    expect(result._meta.cascade.budgetExceeded).toBe(true)
    expect(calls).toEqual(['model-cheap']) // never tried tier 2
  })

    it('propagates provider errors (does not catch them)', async () => {
    const c = cascade({
      tiers: [{ model: 'model-a', evaluate: () => true }, { model: 'model-b' }],
    })

    const tryModel = async () => {
      throw new Error('Provider is down')
    }

    await expect(resolveModel(c, {}, tryModel, extractModelId)).rejects.toThrow('Provider is down')
  })

    it('passes tier context to evaluate function', async () => {
    const evaluateSpy = vi.fn(() => true)

    const c = cascade({
      tiers: [{ model: 'model-a', evaluate: evaluateSpy }],
    })

    const { tryModel } = createTryModel({ 'model-a': 0.003 })
    await resolveModel(c, {}, tryModel, extractModelId)

    expect(evaluateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'response from model-a' }),
      expect.objectContaining({
        model: 'model-a',
        cost: 0.003,
        tierIndex: 0,
        totalCost: 0.003,
      }),
    )
  })
})

// ─────────────────────────────────────────────────────────────────
// Composition
// ─────────────────────────────────────────────────────────────────

describe('resolveModel() — composition', () => {
  it('resolves nested router → cascade', async () => {
    const r = router({
      classify: (input) => ((input as any).complex ? 'hard' : 'easy'),
      routes: {
        easy: 'model-fast',
        hard: cascade({
          tiers: [{ model: 'model-mid', evaluate: () => false }, { model: 'model-powerful' }],
        }),
        default: 'model-fast',
      },
    })

    const { tryModel, calls } = createTryModel()
    const result = await resolveModel(r, { complex: true }, tryModel, extractModelId)

    // Router selected cascade, cascade tried model-mid (rejected) then model-powerful
    expect(calls).toEqual(['model-mid', 'model-powerful'])
    expect(result._meta.router.classifiedAs).toBe('hard')
    expect(result._meta.cascade.acceptedAtTier).toBe(1)
  })
})
