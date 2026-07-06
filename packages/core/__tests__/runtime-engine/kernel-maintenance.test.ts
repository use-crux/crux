import { describe, expect, it, vi } from 'vitest'
import { inMemoryRuntimeStore } from '../../runtime/adapters/memory'
import type {
  FlowId,
  RuntimeTargetId,
  TaskId,
  TimerId,
  WaiterId,
  WorkId,
} from '../../runtime/ports'
import {
  createRuntimeKernel,
  wakeEnvelopeForWork,
} from '../../runtime/engine/kernel'
import { transition, type WorkItem } from '../../runtime/engine/work'

describe('RuntimeKernel maintenance and cancellation composites', () => {
  it('reclaims expired leased work without counting it as a failed attempt', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-07-02T00:00:00.000Z'))
      const store = inMemoryRuntimeStore()
      const kernel = createRuntimeKernel({
        store,
        targets: {},
        newWorkId: () => 'unused' as WorkId,
      })
      const lease = await store.leases.claim('work:work_task_1', {
        ttlMs: 1_000,
      })
      await store.state.putWork(
        transition(makeTaskWork(), {
          status: 'leased',
          leaseToken: lease!.token,
        }),
      )
      vi.advanceTimersByTime(1_001)

      await expect(
        kernel.maintenanceTick({
          namespace: 'tenant-a',
          now: new Date('2026-07-02T00:00:01.001Z'),
        }),
      ).resolves.toMatchObject({ leasesReclaimed: 1 })
      await expect(
        store.state.getWork('work_task_1' as WorkId, {
          namespace: 'tenant-a',
        }),
      ).resolves.toMatchObject({ status: 'pending', attempt: 1 })
      await expect(
        store.outbox.claimPending({
          namespace: 'tenant-a',
          now: new Date('2100-01-01T00:00:00.000Z'),
        }),
      ).resolves.toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('re-enqueues orphaned due pending work that has no pending outbox row', async () => {
    const store = inMemoryRuntimeStore()
    const kernel = createRuntimeKernel({
      store,
      targets: {},
      newWorkId: () => 'unused' as WorkId,
      now: () => new Date('2026-07-02T00:00:00.000Z'),
    })
    const work = makeTaskWork({
      notBefore: new Date('2026-07-02T00:00:10.000Z'),
      updatedAt: new Date('2026-07-02T00:00:09.000Z'),
    })
    await store.state.putWork(work)
    const dispatched = await store.outbox.put(wakeEnvelopeForWork(work), {
      deliverAt: new Date('2026-07-02T00:00:10.000Z'),
    })
    await store.outbox.claimPending({
      namespace: 'tenant-a',
      now: new Date('2026-07-02T00:00:10.000Z'),
      limit: 1,
    })
    await store.outbox.confirm(dispatched.outboxId)

    await expect(
      kernel.maintenanceTick({
        namespace: 'tenant-a',
        now: new Date('2026-07-02T00:00:11.000Z'),
      }),
    ).resolves.toMatchObject({ pendingRequeued: 1 })
    await expect(
      store.outbox.claimPending({
        namespace: 'tenant-a',
        now: new Date('2026-07-02T00:00:11.000Z'),
        limit: 1,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        envelope: expect.objectContaining({ workId: 'work_task_1' }),
        state: 'dispatched',
      }),
    ])
  })

  it('does not re-enqueue future pending work before notBefore passes', async () => {
    const store = inMemoryRuntimeStore()
    const kernel = createRuntimeKernel({
      store,
      targets: {},
      newWorkId: () => 'unused' as WorkId,
    })
    await store.state.putWork(
      makeTaskWork({
        notBefore: new Date('2026-07-02T00:00:10.000Z'),
        updatedAt: new Date('2026-07-02T00:00:00.000Z'),
      }),
    )

    await expect(
      kernel.maintenanceTick({
        namespace: 'tenant-a',
        now: new Date('2026-07-02T00:00:09.999Z'),
      }),
    ).resolves.toMatchObject({ pendingRequeued: 0 })
    await expect(
      store.outbox.claimPending({
        namespace: 'tenant-a',
        now: new Date('2026-07-02T00:00:10.000Z'),
      }),
    ).resolves.toEqual([])
  })

  it('expires timed-out waiters when no timer record fired them', async () => {
    const store = inMemoryRuntimeStore()
    const kernel = createRuntimeKernel({
      store,
      targets: {},
      newWorkId: () => 'unused' as WorkId,
      now: () => new Date('2026-07-02T00:00:00.000Z'),
    })
    await store.state.putWork(makeFlowWork({ status: 'suspended' }))
    await store.waiters.register({
      namespace: 'tenant-a',
      eventName: 'document.approved',
      match: {},
      workId: 'work_flow_1' as WorkId,
      work: { kind: 'flow.timeout', flowId: 'flow_1' as FlowId, suspendPoint: 'approval' },
      timeoutAt: new Date('2026-07-02T00:00:10.000Z'),
    })

    await expect(
      kernel.maintenanceTick({
        namespace: 'tenant-a',
        now: new Date('2026-07-02T00:00:10.000Z'),
      }),
    ).resolves.toMatchObject({ waitersExpired: 1 })
    await expect(
      store.state.getWork('work_flow_1' as WorkId, { namespace: 'tenant-a' }),
    ).resolves.toMatchObject({
      status: 'pending',
      idempotencyKey: 'timer:waiter_1',
    })
  })

  it('tracks scoped idle counters across work creation and terminal completion', async () => {
    const store = inMemoryRuntimeStore()
    const targetId = 'embed-document' as RuntimeTargetId
    const kernel = createRuntimeKernel({
      store,
      targets: {
        [targetId]: {
          targetId,
          kind: 'task',
          execute: async () => ({ status: 'completed' }),
        },
      },
      newWorkId: () => 'work_task_1' as WorkId,
      now: () => new Date('2026-07-02T00:00:00.000Z'),
    })

    const work = await kernel.enqueueTask({
      namespace: 'tenant-a',
      taskId: 'task_1' as TaskId,
      targetId,
      idleScope: 'flow:flow_1',
    })
    await expect(
      store.state.getIdleCount('tenant-a', 'flow:flow_1'),
    ).resolves.toBe(1)

    await kernel.handleWake(wakeEnvelopeForWork(work))

    await expect(
      store.state.getIdleCount('tenant-a', 'flow:flow_1'),
    ).resolves.toBe(0)
    await expect(
      store.events.read({ namespace: 'tenant-a' }),
    ).resolves.toMatchObject({
      events: [
        expect.objectContaining({
          name: 'crux.idle:flow:flow_1',
          payload: { scope: 'flow:flow_1' },
        }),
      ],
    })
  })

  it('resolves scoped idle waiters in the same terminal transition transaction', async () => {
    const store = inMemoryRuntimeStore()
    const targetId = 'embed-document' as RuntimeTargetId
    const kernel = createRuntimeKernel({
      store,
      targets: {
        [targetId]: {
          targetId,
          kind: 'task',
          execute: async () => ({ status: 'completed' }),
        },
      },
      newWorkId: () => 'work_child_1' as WorkId,
      now: () => new Date('2026-07-02T00:00:00.000Z'),
    })
    await store.state.putWork(
      makeFlowWork({
        workId: 'work_parent_1' as WorkId,
        work: { kind: 'flow.resume', flowId: 'flow_parent_1' as FlowId },
        status: 'suspended',
        idempotencyKey: 'resume:work_parent_1:start',
      }),
    )
    await store.waiters.register({
      namespace: 'tenant-a',
      eventName: 'crux.idle:flow:flow_1',
      match: { scope: 'flow:flow_1' },
      workId: 'work_parent_1' as WorkId,
      work: { kind: 'flow.resume', flowId: 'flow_parent_1' as FlowId },
    })

    const child = await kernel.enqueueTask({
      namespace: 'tenant-a',
      taskId: 'task_1' as TaskId,
      targetId,
      idleScope: 'flow:flow_1',
    })
    await kernel.handleWake(wakeEnvelopeForWork(child))

    await expect(
      store.state.getWork('work_parent_1' as WorkId, {
        namespace: 'tenant-a',
      }),
    ).resolves.toMatchObject({
      status: 'pending',
      idempotencyKey: 'resume:work_parent_1:evt_1',
    })
    await expect(
      store.waiters.transition('waiter_1' as WaiterId, 'armed', 'fired'),
    ).resolves.toBe(false)
  })

  it('cancels non-terminal work with its owned waiters and timers', async () => {
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
      snapshot: { input: {}, completedSteps: {}, fingerprint: [] },
      suspends: [
        {
          label: 'approval',
          eventName: 'document.approved',
          match: {},
          timeoutAt: new Date('2026-07-02T00:01:00.000Z'),
        },
      ],
    })

    await expect(
      kernel.cancelWork({
        namespace: 'tenant-a',
        workId: 'work_flow_1' as WorkId,
      }),
    ).resolves.toEqual({ cancelled: true })
    await expect(
      store.state.getWork('work_flow_1' as WorkId, { namespace: 'tenant-a' }),
    ).resolves.toMatchObject({ status: 'cancelled' })
    await expect(
      store.waiters.transition('waiter_1' as WaiterId, 'armed', 'fired'),
    ).resolves.toBe(false)
    await expect(
      store.timers.transition(
        'timer_1' as TimerId,
        'scheduled',
        'fired',
      ),
    ).resolves.toBe(false)
    await expect(
      store.events.read({ namespace: 'tenant-a' }),
    ).resolves.toMatchObject({
      events: [
        expect.objectContaining({
          name: 'crux.cancelled:work_flow_1',
          payload: { workId: 'work_flow_1' },
        }),
      ],
    })
  })

})

function makeFlowWork(overrides: Partial<WorkItem> = {}): WorkItem {
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

function makeTaskWork(overrides: Partial<WorkItem> = {}): WorkItem {
  const now = new Date('2026-07-02T00:00:00.000Z')
  return {
    workId: 'work_task_1' as WorkId,
    namespace: 'tenant-a',
    work: {
      kind: 'task.run',
      taskId: 'task_1' as TaskId,
      targetId: 'embed-document' as RuntimeTargetId,
    },
    targetId: 'embed-document' as RuntimeTargetId,
    status: 'pending',
    attempt: 1,
    maxAttempts: 8,
    idempotencyKey: 'task:work_task_1',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}
