import { afterEach, describe, expect, it, vi } from 'vitest'
import { TimeoutError, withBudget } from '../../generation/timeout'

afterEach(() => {
  vi.useRealTimers()
})

describe('generation timeout budgets', () => {
  it('rejects with a typed TimeoutError carrying budget metadata', async () => {
    vi.useFakeTimers()

    const result = withBudget(
      () => new Promise<string>((resolve) => setTimeout(() => resolve('late'), 1_000)),
      { budget: 'step', limitMs: 50 },
    )

    const assertion = expect(result).rejects.toMatchObject({
      name: 'TimeoutError',
      budget: 'step',
      limitMs: 50,
    })
    const instanceAssertion = expect(result).rejects.toBeInstanceOf(TimeoutError)

    await vi.advanceTimersByTimeAsync(50)

    await assertion
    await instanceAssertion
  })

  it('includes the tool name when a per-tool budget expires', async () => {
    vi.useFakeTimers()

    const result = withBudget(
      () => new Promise<string>((resolve) => setTimeout(() => resolve('late'), 1_000)),
      { budget: 'tool', limitMs: 25, toolName: 'search' },
    )

    const assertion = expect(result).rejects.toMatchObject({
      budget: 'tool',
      limitMs: 25,
      toolName: 'search',
    })

    await vi.advanceTimersByTimeAsync(25)

    await assertion
  })
})
