import { describe, expect, it } from 'vitest'
import { inMemoryRuntimeStore } from '../../src/runtime/adapters/memory'
import type {
  FlowId,
  RuntimeTargetId,
  WaiterId,
  WorkId,
} from '../../src/runtime/ports'
import { createRuntimeKernel } from '../../src/runtime/engine/kernel'
import type { RuntimeWorkItem } from '../../src/runtime/engine/work'

describe('RuntimeKernel timer composites', () => {
  it('fires a timeout timer by winning the waiter CAS and resuming existing flow work', async () => {
    const store = inMemoryRuntimeStore()
    const kernel = createRuntimeKernel({
      store,
      targets: {},
      newWorkId: () => 'unused' as WorkId,
      now: () => new Date('2026-07-02T00:00:00.000Z'),
    })
    await store.state.putWork(makeFlowWork({ status: 'leased' }))

    await kernel.recordSuspension({
      namespace: 'tenant-a',
      workId: 'work_flow_1' as WorkId,
      flowId: 'flow_1' as FlowId,
      targetId: 'review' as RuntimeTargetId,
      snapshot: {
        input: { documentId: 'doc_1' },
        completedSteps: {},
        fingerprint: ['waitFor:document.approved'],
      },
      suspends: [
        {
          label: 'approval',
          eventName: 'document.approved',
          match: { documentId: 'doc_1' },
          timeoutAt: new Date('2026-07-02T00:00:10.000Z'),
        },
      ],
    })

    await expect(
      store.state.getSnapshot('flow_1' as FlowId, { namespace: 'tenant-a' }),
    ).resolves.toMatchObject({
      pendingSuspends: [
        {
          label: 'approval',
          waiterId: 'waiter_1',
          timerId: 'timer_1',
        },
      ],
    })

    await expect(
      kernel.scanTimers({
        namespace: 'tenant-a',
        now: new Date('2026-07-02T00:00:09.999Z'),
      }),
    ).resolves.toMatchObject({ fired: 0, skipped: 0 })

    await expect(
      kernel.scanTimers({
        namespace: 'tenant-a',
        now: new Date('2026-07-02T00:00:10.000Z'),
      }),
    ).resolves.toMatchObject({ fired: 1, skipped: 0 })
    await expect(
      store.state.getWork('work_flow_1' as WorkId, { namespace: 'tenant-a' }),
    ).resolves.toMatchObject({
      status: 'pending',
      attempt: 1,
      idempotencyKey: 'timer:timer_1',
      work: {
        kind: 'flow.timeout',
        flowId: 'flow_1',
        suspendPoint: 'approval',
      },
    })
    await expect(
      store.waiters.transition('waiter_1' as WaiterId, 'armed', 'fired'),
    ).resolves.toBe(false)
    await expect(
      store.outbox.claimPending({
        namespace: 'tenant-a',
        now: new Date('2100-01-01T00:00:00.000Z'),
      }),
    ).resolves.toHaveLength(1)
  })

  it('does not produce timeout work when the event side already won the waiter race', async () => {
    const store = inMemoryRuntimeStore()
    const kernel = createRuntimeKernel({
      store,
      targets: {},
      newWorkId: () => 'unused' as WorkId,
      now: () => new Date('2026-07-02T00:00:00.000Z'),
    })
    await store.state.putWork(makeFlowWork({ status: 'leased' }))
    await kernel.recordSuspension({
      namespace: 'tenant-a',
      workId: 'work_flow_1' as WorkId,
      flowId: 'flow_1' as FlowId,
      targetId: 'review' as RuntimeTargetId,
      snapshot: {
        input: { documentId: 'doc_1' },
        completedSteps: {},
        fingerprint: ['waitFor:document.approved'],
      },
      suspends: [
        {
          label: 'approval',
          eventName: 'document.approved',
          match: { documentId: 'doc_1' },
          timeoutAt: new Date('2026-07-02T00:00:10.000Z'),
        },
      ],
    })

    await kernel.emitEvent({
      namespace: 'tenant-a',
      name: 'document.approved',
      payload: { documentId: 'doc_1' },
    })

    await expect(
      kernel.scanTimers({
        namespace: 'tenant-a',
        now: new Date('2026-07-02T00:00:10.000Z'),
      }),
    ).resolves.toMatchObject({ fired: 0, skipped: 0 })
    await expect(
      store.state.getWork('work_flow_1' as WorkId, { namespace: 'tenant-a' }),
    ).resolves.toMatchObject({
      status: 'pending',
      idempotencyKey: 'resume:work_flow_1:evt_1',
    })
    await expect(
      store.outbox.claimPending({
        namespace: 'tenant-a',
        now: new Date('2100-01-01T00:00:00.000Z'),
      }),
    ).resolves.toHaveLength(1)
  })
})

function makeFlowWork(overrides: Partial<RuntimeWorkItem> = {}): RuntimeWorkItem {
  const now = new Date('2026-07-02T00:00:00.000Z')
  return {
    workId: 'work_flow_1' as WorkId,
    namespace: 'tenant-a',
    work: { kind: 'flow.resume', flowId: 'flow_1' as FlowId },
    targetId: 'review' as RuntimeTargetId,
    status: 'pending',
    attempt: 1,
    maxAttempts: 8,
    idempotencyKey: 'resume:work_flow_1:start',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}
