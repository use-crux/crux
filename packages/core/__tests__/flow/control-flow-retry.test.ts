import { afterEach, describe, expect, it } from 'vitest'
import { flow } from '../../flow'
import { resetHooks, updateHooks } from '../../runtime/runtime'
import { inMemoryRecordStore } from '../../storage'

describe('flow retry control-flow safety', () => {
  afterEach(() => {
    resetHooks()
  })

  it('does not retry a step that suspends the flow', async () => {
    updateHooks({ records: inMemoryRecordStore() })
    let calls = 0

    const review = flow('step suspend retry safety', async (scope) => {
      await scope.step(
        'await approval',
        async () => {
          calls += 1
          await scope.suspend('approval')
          return 'unreachable'
        },
        { retry: { attempts: 3, delay: 0 } },
      )

      return 'published'
    })

    await expect(review.run({ flowId: 'flow-step-suspend-retry' })).resolves.toMatchObject({
      status: 'suspended',
      flowId: 'flow-step-suspend-retry',
      suspendedAt: 'approval',
    })
    expect(calls).toBe(1)
  })

  it('does not retry a step that cancels the flow', async () => {
    updateHooks({ records: inMemoryRecordStore() })
    let calls = 0

    const review = flow('step cancel retry safety', async (scope) => {
      await scope.step(
        'reject review',
        () => {
          calls += 1
          scope.cancel('Reviewer rejected')
        },
        { retry: { attempts: 3, delay: 0 } },
      )

      return 'published'
    })

    await expect(review.run({ flowId: 'flow-step-cancel-retry' })).resolves.toMatchObject({
      status: 'cancelled',
      flowId: 'flow-step-cancel-retry',
      cancelReason: 'Reviewer rejected',
    })
    expect(calls).toBe(1)
  })

  it('does not run step fallback for lifecycle control-flow', async () => {
    updateHooks({ records: inMemoryRecordStore() })
    const fallbackCalls: string[] = []

    const suspending = flow('step suspend fallback safety', async (scope) => {
      await scope.step(
        'await approval',
        async () => {
          await scope.suspend('approval')
          return 'unreachable'
        },
        {
          retry: { attempts: 3, delay: 0 },
          fallback: () => {
            fallbackCalls.push('suspend')
            return 'fallback'
          },
        },
      )

      return 'published'
    })

    await expect(suspending.run({ flowId: 'flow-step-suspend-fallback' })).resolves.toMatchObject({
      status: 'suspended',
      flowId: 'flow-step-suspend-fallback',
      suspendedAt: 'approval',
    })

    const cancelling = flow('step cancel fallback safety', async (scope) => {
      await scope.step(
        'reject review',
        () => {
          scope.cancel('Reviewer rejected')
        },
        {
          retry: { attempts: 3, delay: 0 },
          fallback: () => {
            fallbackCalls.push('cancel')
            return 'fallback'
          },
        },
      )

      return 'published'
    })

    await expect(cancelling.run({ flowId: 'flow-step-cancel-fallback' })).resolves.toMatchObject({
      status: 'cancelled',
      flowId: 'flow-step-cancel-fallback',
      cancelReason: 'Reviewer rejected',
    })

    const expiring = flow('step expire fallback safety', async (scope) => {
      await scope.step(
        'await timed approval',
        async () => {
          await scope.suspend('approval', { timeout: '0ms' })
          return 'unreachable'
        },
        {
          retry: { attempts: 3, delay: 0 },
          fallback: () => {
            fallbackCalls.push('expire')
            return 'fallback'
          },
        },
      )

      return 'published'
    })

    const suspended = await expiring.run({ flowId: 'flow-step-expire-fallback' })
    expect(suspended).toMatchObject({
      status: 'suspended',
      flowId: 'flow-step-expire-fallback',
      suspendedAt: 'approval',
    })
    await expiring.signal(suspended.flowId, 'approval')
    await new Promise((resolve) => setTimeout(resolve, 5))

    await expect(expiring.resume(suspended.flowId)).resolves.toMatchObject({
      status: 'expired',
      flowId: 'flow-step-expire-fallback',
      suspendedAt: 'approval',
    })
    expect(fallbackCalls).toEqual([])
  })
})
