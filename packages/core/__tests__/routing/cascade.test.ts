import { describe, it, expect } from 'vitest'
import { cascade, isCascade } from '../../src/routing'

describe('cascade()', () => {
  it('creates a CascadeModel with correct _tag and config', () => {
    const c = cascade({
      tiers: [{ model: 'model-cheap', evaluate: () => true }, { model: 'model-expensive' }],
    })

    expect(c._tag).toBe('crux.cascade')
    expect(c.config.tiers).toHaveLength(2)
    expect(c.config.tiers[0].model).toBe('model-cheap')
    expect(c.config.tiers[1].model).toBe('model-expensive')
  })

    it('accepts budget configuration', () => {
    const c = cascade({
      tiers: [{ model: 'model-a' }],
      budget: { maxCost: 0.05, maxLatencyMs: 5000 },
    })

    expect(c.config.budget).toEqual({ maxCost: 0.05, maxLatencyMs: 5000 })
  })

    it('accepts stable index metadata', () => {
    const c = cascade({
      id: 'quality-cascade',
      description: 'Escalate when cheap output is not good enough',
      tiers: [{ model: 'model-a' }],
    })

    expect(c.config.id).toBe('quality-cascade')
    expect(c.config.description).toBe('Escalate when cheap output is not good enough')
  })

    it('returns a frozen immutable object', () => {
    const c = cascade({
      tiers: [{ model: 'model-a' }],
    })

    expect(Object.isFrozen(c)).toBe(true)
  })
})

describe('isCascade()', () => {
  it('returns true for a CascadeModel', () => {
    const c = cascade({ tiers: [{ model: 'a' }] })
    expect(isCascade(c)).toBe(true)
  })

    it('returns false for regular objects', () => {
    expect(isCascade({ provider: 'openai', modelId: 'gpt-4o' })).toBe(false)
  })

    it('returns false for null/undefined/strings', () => {
    expect(isCascade(null)).toBe(false)
    expect(isCascade(undefined)).toBe(false)
    expect(isCascade('gpt-4o')).toBe(false)
  })
})
