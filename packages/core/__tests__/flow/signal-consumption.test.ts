import { afterEach, describe, expect, it } from 'vitest'
import { flow } from '../../flow'
import { resetRuntime, updateRuntime } from '../../runtime/runtime'
import { inMemoryRecordStore } from '../../storage'

describe('flow signal consumption', () => {
  afterEach(() => {
    resetRuntime()
  })

  it('consumes a delivered signal before user code continues past suspend', async () => {
    const store = inMemoryRecordStore()
    updateRuntime({ records: store })

    const review = flow('consume delivered signal', async (scope) => {
      await scope.suspend('approval')
      await scope.suspend('approval')
      return 'published'
    })

    const suspended = await review.run({ flowId: 'flow-signal-consumption' })
    expect(suspended).toMatchObject({
      status: 'suspended',
      flowId: 'flow-signal-consumption',
      suspendedAt: 'approval',
    })

    await review.signal(suspended.flowId, 'approval')

    const awaitingSecondApproval = await review.resume(suspended.flowId)
    expect(awaitingSecondApproval).toMatchObject({
      status: 'suspended',
      flowId: suspended.flowId,
      suspendedAt: 'approval',
    })
    await expect(store.get(`crux:signal:${suspended.flowId}:approval`)).resolves.toBeNull()

    await review.signal(suspended.flowId, 'approval')

    const completed = await review.resume(suspended.flowId)
    expect(completed).toMatchObject({
      status: 'completed',
      flowId: suspended.flowId,
      output: 'published',
    })
  })
})
