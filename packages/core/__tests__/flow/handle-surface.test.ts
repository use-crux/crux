import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { cancelFlow, flow, listFlows, noPayload } from '../../flow'
import { resetHooks, updateHooks } from '../../runtime/runtime'
import { inMemoryRecordStore } from '../../storage'

describe('flow handle surface', () => {
  afterEach(() => {
    resetHooks()
  })

  it('persists run input and restores it for resume', async () => {
    const store = inMemoryRecordStore()
    updateHooks({ records: store })

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
    updateHooks({ records: store })

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

  it('rejects invalid typed signal payloads before writing them', async () => {
    const store = inMemoryRecordStore()
    updateHooks({ records: store })

    const review = flow(
      'typed signal send validation',
      {
        signals: {
          approval: z.object({
            approved: z.boolean(),
          }),
        },
      },
      async (scope) => {
        const approval = await scope.suspend('approval')
        return approval.approved
      },
    )

    const suspended = await review.run({ flowId: 'flow-invalid-signal-send' })
    expect(suspended.status).toBe('suspended')

    await expect(
      review.signal(suspended.flowId, 'approval', {
        approved: 'yes',
      } as never),
    ).rejects.toThrow(/Invalid signal payload for "approval"/)

    await expect(store.get(`crux:signal:${suspended.flowId}:approval`)).resolves.toBeNull()
  })

  it('rejects invalid persisted signal payloads during resume delivery', async () => {
    const store = inMemoryRecordStore()
    updateHooks({ records: store })

    const review = flow(
      'typed signal resume validation',
      {
        signals: {
          approval: z.object({
            approved: z.boolean(),
          }),
        },
      },
      async (scope) => {
        const approval = await scope.suspend('approval')
        return approval.approved
      },
    )

    const suspended = await review.run({ flowId: 'flow-invalid-signal-resume' })
    expect(suspended.status).toBe('suspended')

    await store.put(`crux:signal:${suspended.flowId}:approval`, {
      payload: { approved: 'yes' },
      signaledAt: Date.now(),
      updatedAt: Date.now(),
    })

    await expect(review.resume(suspended.flowId)).rejects.toThrow(/Invalid signal payload for "approval"/)
  })

  it('marks resumed flows completed instead of leaving a suspended snapshot', async () => {
    const store = inMemoryRecordStore()
    updateHooks({ records: store })

    const review = flow('terminal completion snapshot', async (scope) => {
      await scope.suspend('approval')
      return 'published'
    })

    const suspended = await review.run({ flowId: 'flow-completes-after-resume' })
    expect(suspended.status).toBe('suspended')

    await review.signal(suspended.flowId, 'approval')

    const completed = await review.resume(suspended.flowId)
    expect(completed.status).toBe('completed')

    await expect(store.get(`crux:flow:${suspended.flowId}`)).resolves.toMatchObject({
      status: 'completed',
      suspendedAt: 'approval',
      flowId: suspended.flowId,
      name: 'terminal completion snapshot',
    })

    const suspendedFlows = await listFlows({ status: 'suspended' })
    expect(suspendedFlows.some((flow) => flow.flowId === suspended.flowId)).toBe(false)
  })

  it('rejects terminal snapshots before executing the flow handler', async () => {
    const store = inMemoryRecordStore()
    updateHooks({ records: store })
    const executions: string[] = []

    const review = flow('terminal resume guard', async (scope) => {
      executions.push(scope.flowId)
      await scope.suspend('approval')
      return 'published'
    })
    const expiringReview = flow('terminal expired resume guard', async (scope) => {
      executions.push(scope.flowId)
      await scope.suspend('approval', { timeout: '0ms' })
      return 'published'
    })

    const completedSuspension = await review.run({ flowId: 'flow-terminal-completed' })
    expect(completedSuspension.status).toBe('suspended')
    await review.signal(completedSuspension.flowId, 'approval')
    await expect(review.resume(completedSuspension.flowId)).resolves.toMatchObject({ status: 'completed' })
    const completedSnapshot = await store.get(`crux:flow:${completedSuspension.flowId}`)
    await cancelFlow(completedSuspension.flowId, 'Too late')
    await expect(store.get(`crux:flow:${completedSuspension.flowId}`)).resolves.toEqual(completedSnapshot)

    const cancelledSuspension = await review.run({ flowId: 'flow-terminal-cancelled' })
    expect(cancelledSuspension.status).toBe('suspended')
    await cancelFlow(cancelledSuspension.flowId, 'Admin cancelled')

    const expiredSuspension = await expiringReview.run({ flowId: 'flow-terminal-expired' })
    expect(expiredSuspension.status).toBe('suspended')
    await expiringReview.signal(expiredSuspension.flowId, 'approval')
    await new Promise((resolve) => setTimeout(resolve, 5))
    await expect(expiringReview.resume(expiredSuspension.flowId)).resolves.toMatchObject({ status: 'expired' })

    executions.length = 0

    await expect(review.resume(completedSuspension.flowId)).rejects.toThrow(/cannot be resumed/)
    await expect(review.resume(cancelledSuspension.flowId)).rejects.toThrow(/cannot be resumed/)
    await expect(expiringReview.resume(expiredSuspension.flowId)).rejects.toThrow(/cannot be resumed/)
    expect(executions).toEqual([])
  })

  it('persists terminal metadata for cancelled and expired snapshots', async () => {
    const store = inMemoryRecordStore()
    updateHooks({ records: store })

    const internalCancel = flow('internal cancel metadata', async (scope) => {
      await scope.step('plan', () => ({ planId: 'internal' }))
      scope.cancel('Invalid plan')
    })
    const externalCancel = flow('external cancel metadata', async (scope) => {
      await scope.step('plan', () => ({ planId: 'external' }))
      await scope.suspend('approval')
    })
    const expiring = flow('expired metadata', async (scope) => {
      await scope.step('plan', () => ({ planId: 'expired' }))
      await scope.suspend('approval', { timeout: '0ms' })
    })

    await expect(internalCancel.run({ flowId: 'flow-internal-cancel-metadata' })).resolves.toMatchObject({
      status: 'cancelled',
      cancelReason: 'Invalid plan',
    })
    await expect(store.get('crux:flow:flow-internal-cancel-metadata')).resolves.toMatchObject({
      status: 'cancelled',
      cancelReason: 'Invalid plan',
      cancelledAt: expect.any(Number),
      completedSteps: {
        plan: {
          output: { planId: 'internal' },
          durationMs: expect.any(Number),
        },
      },
    })

    const suspended = await externalCancel.run({ flowId: 'flow-external-cancel-metadata' })
    expect(suspended.status).toBe('suspended')
    await cancelFlow(suspended.flowId, 'Admin cancelled')
    await expect(store.get(`crux:flow:${suspended.flowId}`)).resolves.toMatchObject({
      status: 'cancelled',
      cancelReason: 'Admin cancelled',
      cancelledAt: expect.any(Number),
      completedSteps: {
        plan: {
          output: { planId: 'external' },
          durationMs: expect.any(Number),
        },
      },
    })

    const expiredSuspension = await expiring.run({ flowId: 'flow-expired-metadata' })
    expect(expiredSuspension.status).toBe('suspended')
    await expiring.signal(expiredSuspension.flowId, 'approval')
    await new Promise((resolve) => setTimeout(resolve, 5))
    await expect(expiring.resume(expiredSuspension.flowId)).resolves.toMatchObject({ status: 'expired' })
    await expect(store.get(`crux:flow:${expiredSuspension.flowId}`)).resolves.toMatchObject({
      status: 'expired',
      expiredAt: expect.any(Number),
      suspendedAt: 'approval',
      completedSteps: {
        plan: {
          output: { planId: 'expired' },
          durationMs: expect.any(Number),
        },
      },
    })
  })
})
