import { describe, it, expect } from 'vitest'
import { createBudgetManager } from '../../compaction/budget'

describe('createBudgetManager', () => {
  it('starts with zero usage', () => {
    const budget = createBudgetManager({ limit: 100_000 })
    const state = budget.check()

    expect(state.used).toBe(0)
    expect(state.available).toBe(100_000)
    expect(state.pressure).toBe(0)
    expect(state.level).toBe('normal')
  })

  it('tracks reported sources', () => {
    const budget = createBudgetManager({ limit: 100_000 })
    budget.report('system', 5_000)
    budget.report('messages', 20_000)

    const state = budget.check()
    expect(state.used).toBe(25_000)
    expect(state.available).toBe(75_000)
    expect(state.breakdown).toEqual({ system: 5_000, messages: 20_000 })
  })

  it('replaces previous value for same source', () => {
    const budget = createBudgetManager({ limit: 100_000 })
    budget.report('messages', 10_000)
    budget.report('messages', 30_000)

    const state = budget.check()
    expect(state.used).toBe(30_000)
    expect(state.breakdown.messages).toBe(30_000)
  })

  it('computes pressure correctly', () => {
    const budget = createBudgetManager({ limit: 100_000 })
    budget.report('messages', 50_000)

    expect(budget.check().pressure).toBeCloseTo(0.5)
  })

  it('reports normal level below warning threshold', () => {
    const budget = createBudgetManager({
      limit: 100_000,
      warningThreshold: 0.8,
    })
    budget.report('messages', 79_000)

    expect(budget.check().level).toBe('normal')
  })

  it('reports warning level at warning threshold', () => {
    const budget = createBudgetManager({
      limit: 100_000,
      warningThreshold: 0.8,
    })
    budget.report('messages', 80_000)

    expect(budget.check().level).toBe('warning')
  })

  it('reports warning level between thresholds', () => {
    const budget = createBudgetManager({ limit: 100_000 })
    budget.report('messages', 90_000)

    expect(budget.check().level).toBe('warning')
  })

  it('reports critical level at critical threshold', () => {
    const budget = createBudgetManager({
      limit: 100_000,
      criticalThreshold: 0.95,
    })
    budget.report('messages', 95_000)

    expect(budget.check().level).toBe('critical')
  })

  it('reports critical level above limit', () => {
    const budget = createBudgetManager({ limit: 100_000 })
    budget.report('messages', 110_000)

    const state = budget.check()
    expect(state.level).toBe('critical')
    expect(state.available).toBe(0)
    expect(state.pressure).toBeCloseTo(1.1)
  })

  it('uses default thresholds (0.8 warning, 0.95 critical)', () => {
    const budget = createBudgetManager({ limit: 100 })

    budget.report('a', 79)
    expect(budget.check().level).toBe('normal')

    budget.report('a', 80)
    expect(budget.check().level).toBe('warning')

    budget.report('a', 95)
    expect(budget.check().level).toBe('critical')
  })

  it('supports custom thresholds', () => {
    const budget = createBudgetManager({
      limit: 100,
      warningThreshold: 0.5,
      criticalThreshold: 0.7,
    })

    budget.report('a', 49)
    expect(budget.check().level).toBe('normal')

    budget.report('a', 50)
    expect(budget.check().level).toBe('warning')

    budget.report('a', 70)
    expect(budget.check().level).toBe('critical')
  })

  it('reset clears all sources', () => {
    const budget = createBudgetManager({ limit: 100_000 })
    budget.report('system', 5_000)
    budget.report('messages', 20_000)
    budget.reset()

    const state = budget.check()
    expect(state.used).toBe(0)
    expect(state.breakdown).toEqual({})
  })

  it('handles zero limit gracefully', () => {
    const budget = createBudgetManager({ limit: 0 })
    budget.report('a', 100)

    const state = budget.check()
    expect(state.pressure).toBe(0)
    expect(state.available).toBe(0)
  })

  it('tracks many sources independently', () => {
    const budget = createBudgetManager({ limit: 100_000 })
    budget.report('system', 1_000)
    budget.report('messages', 2_000)
    budget.report('memory', 3_000)
    budget.report('tools', 4_000)

    const state = budget.check()
    expect(state.used).toBe(10_000)
    expect(Object.keys(state.breakdown)).toHaveLength(4)
  })
})
