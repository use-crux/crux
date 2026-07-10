import { afterEach, describe, expect, it } from 'vitest'
import { flow } from '../../src/flow'
import { resetHooks } from '../../src/runtime/runtime'

describe('flow step identity', () => {
  afterEach(() => {
    resetHooks()
  })

  it('rejects duplicate step labels before ambiguous replay cache use', async () => {
    const calls: string[] = []

    const duplicateLabels = flow('duplicate step labels', async (scope) => {
      await scope.step('plan', () => {
        calls.push('first')
        return 'first result'
      })

      return scope.step('plan', () => {
        calls.push('second')
        return 'second result'
      })
    })

    await expect(duplicateLabels.run()).rejects.toThrow('Duplicate flow step label "plan"')
    expect(calls).toEqual(['first'])
  })
})
