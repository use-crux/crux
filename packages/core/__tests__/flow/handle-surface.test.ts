import { afterEach, describe, expect, it } from 'vitest'
import { flow } from '../../flow'
import { resetRuntime, updateRuntime } from '../../runtime/runtime'
import { inMemoryRecordStore } from '../../storage'

describe('flow handle surface', () => {
  afterEach(() => {
    resetRuntime()
  })

  it('persists run input and restores it for resume', async () => {
    const store = inMemoryRecordStore()
    updateRuntime({ records: store })

    const review = flow('input resume', async (scope, input: { docId: string }) => {
      const loaded = await scope.step('load', () => ({ docId: input.docId }))
      await scope.suspend('approval')
      return scope.step('publish', () => ({
        docId: input.docId,
        loadedDocId: loaded.docId,
      }))
    })

    const suspended = await review.run({ docId: 'doc_123' }, { flowId: 'flow-input-resume' })
    expect(suspended).toMatchObject({
      status: 'suspended',
      flowId: 'flow-input-resume',
      suspendedAt: 'approval',
    })

    await review.signal(suspended.flowId, 'approval')

    const completed = await review.resume(suspended.flowId)
    expect(completed.status).toBe('completed')
    if (completed.status === 'completed') {
      expect(completed.output).toEqual({
        docId: 'doc_123',
        loadedDocId: 'doc_123',
      })
    }
  })
})
