import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { resetRuntime, updateRuntime } from '@use-crux/core'
import { resetObservabilityRuntime } from '@use-crux/core/observability'
import { inMemoryRecordStore } from '@use-crux/core/storage'
import { flow } from '../server'

describe('@use-crux/convex/server flow', () => {
  afterEach(() => {
    resetObservabilityRuntime()
    resetRuntime()
    vi.restoreAllMocks()
  })

  it('validates declared signal payloads before scheduling a resume action', async () => {
    updateRuntime({ records: inMemoryRecordStore() })
    const scheduler = {
      runAfter: vi.fn(async () => undefined),
    }
    const reviewFlow = flow({
      name: 'convex-typed-review',
      args: { draftId: 'validator-placeholder' },
      signals: {
        approval: z.object({ approved: z.boolean() }),
      },
      handler: async (scope) => {
        const approval = await scope.suspend('approval')
        return approval.approved
      },
    })

    const suspended = await reviewFlow.action.handler({ scheduler }, { draftId: 'draft-1' })

    expect(suspended).toMatchObject({ status: 'suspended', suspendedAt: 'approval' })
    if (suspended.status !== 'suspended') return

    await expect(
      reviewFlow.signal({ scheduler } as never, reviewFlow.action, suspended.flowId, 'approval', {
        approved: 'yes',
      } as never),
    ).rejects.toThrow('Invalid signal payload for "approval"')
    expect(scheduler.runAfter).not.toHaveBeenCalled()
  })

  it('resumes Convex flows with validated declared signal payloads', async () => {
    updateRuntime({ records: inMemoryRecordStore() })
    const scheduled: Array<{ ref: unknown; args: Record<string, unknown> }> = []
    const scheduler = {
      runAfter: vi.fn(async (_delayMs: number, ref: unknown, args: Record<string, unknown>) => {
        scheduled.push({ ref, args })
      }),
    }
    const reviewFlow = flow({
      name: 'convex-approved-review',
      args: { draftId: 'validator-placeholder' },
      signals: {
        approval: z.object({ approved: z.boolean() }),
      },
      handler: async (scope) => {
        const approval = await scope.suspend('approval')
        return approval.approved
      },
    })

    const suspended = await reviewFlow.action.handler({ scheduler }, { draftId: 'draft-1' })

    expect(suspended).toMatchObject({ status: 'suspended', suspendedAt: 'approval' })
    if (suspended.status !== 'suspended') return

    await reviewFlow.signal({ scheduler } as never, reviewFlow.action, suspended.flowId, 'approval', {
      approved: true,
    })

    expect(scheduled[0]).toMatchObject({
      ref: reviewFlow.action,
      args: expect.objectContaining({ resume: suspended.flowId }),
    })
    await expect(reviewFlow.action.handler({ scheduler }, scheduled[0]!.args as never)).resolves.toMatchObject({
      status: 'completed',
      flowId: suspended.flowId,
      output: true,
    })
  })
})
