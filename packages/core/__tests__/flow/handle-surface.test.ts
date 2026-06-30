import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { flow, noPayload } from '../../flow'
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

  it('signals typed local signal maps through the flow handle', async () => {
    const store = inMemoryRecordStore()
    updateRuntime({ records: store })

    const review = flow(
      'typed signal map',
      {
        signals: {
          approval: z.object({
            approved: z.boolean(),
            note: z.string().optional(),
          }),
          release: noPayload(),
        },
      },
      async (scope, input: { docId: string }) => {
        const approval = await scope.suspend('approval')
        await scope.suspend('release')
        return {
          approved: approval.approved,
          docId: input.docId,
          note: approval.note ?? null,
        }
      },
    )

    const suspended = await review.run({ docId: 'doc_123' }, { flowId: 'flow-typed-signals' })
    expect(suspended).toMatchObject({
      status: 'suspended',
      flowId: 'flow-typed-signals',
      suspendedAt: 'approval',
    })

    await review.signal(suspended.flowId, 'approval', {
      approved: true,
      note: 'ship it',
    })
    await expect(store.get(`crux:signal:${suspended.flowId}:approval`)).resolves.toMatchObject({
      payload: { approved: true, note: 'ship it' },
    })

    const awaitingRelease = await review.resume(suspended.flowId)
    expect(awaitingRelease).toMatchObject({
      status: 'suspended',
      flowId: suspended.flowId,
      suspendedAt: 'release',
    })

    await review.signal(suspended.flowId, 'release')

    const completed = await review.resume(suspended.flowId)
    expect(completed.status).toBe('completed')
    if (completed.status === 'completed') {
      expect(completed.output).toEqual({
        approved: true,
        docId: 'doc_123',
        note: 'ship it',
      })
    }
  })
})
