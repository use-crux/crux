import { expect, it } from 'vitest'
import type { FlowId, RuntimeTargetId, TaskId, WorkId } from '../ports'
import type { RuntimeStoreAdapter } from '../store'
import { makeConformanceWorkItem } from './store-fixtures'
import type { RunStoreAdapterTestsOptions } from './store-types'

export function registerStoreRetentionTests<TStore extends RuntimeStoreAdapter>(
  options: RunStoreAdapterTestsOptions<TStore>,
): void {
  it('invariant: retention pruning removes only eligible terminal records in bounded batches', async () => {
    const store = await options.createStore()
    const cutoff = new Date('2999-01-01T00:00:00.000Z')

    await store.events.append({
      namespace: 'tenant-a',
      name: 'first',
      payload: { n: 1 },
    })
    await store.events.append({
      namespace: 'tenant-a',
      name: 'second',
      payload: { n: 2 },
    })
    await store.events.append({
      namespace: 'tenant-b',
      name: 'other',
      payload: { n: 3 },
    })

    await expect(
      store.events.prune({ namespace: 'tenant-a', before: cutoff, limit: 1 }),
    ).resolves.toEqual({ removed: 1, truncated: true })
    await expect(store.events.read({ namespace: 'tenant-a' })).resolves.toEqual(
      {
        events: [expect.objectContaining({ name: 'second' })],
        cursor: expect.anything(),
      },
    )

    await store.state.putWork(
      makeConformanceWorkItem({
        workId: 'work_pending' as WorkId,
        status: 'pending',
        updatedAt: new Date('2026-07-01T00:00:00.000Z'),
      }),
    )
    await store.state.putWork(
      makeConformanceWorkItem({
        workId: 'work_completed' as WorkId,
        status: 'completed',
        updatedAt: new Date('2026-07-01T00:00:00.000Z'),
      }),
    )
    await store.state.putWork(
      makeConformanceWorkItem({
        workId: 'work_cancelled' as WorkId,
        status: 'cancelled',
        updatedAt: new Date('2026-07-01T00:00:00.000Z'),
      }),
    )
    await expect(
      store.state.pruneTerminalWork({
        namespace: 'tenant-a',
        before: cutoff,
        limit: 1,
      }),
    ).resolves.toEqual({ removed: 1, truncated: true })
    await expect(
      store.state.getWork('work_pending' as WorkId, { namespace: 'tenant-a' }),
    ).resolves.toMatchObject({ status: 'pending' })

    await store.state.putSnapshot({
      flowId: 'flow_live' as FlowId,
      workId: 'work_pending' as WorkId,
      targetId: 'review' as RuntimeTargetId,
      namespace: 'tenant-a',
      status: 'suspended',
      input: {},
      completedSteps: {},
      fingerprint: [],
      pendingSuspends: [],
      updatedAt: new Date('2026-07-01T00:00:00.000Z'),
    })
    await store.state.putSnapshot({
      flowId: 'flow_done' as FlowId,
      workId: 'work_completed' as WorkId,
      targetId: 'review' as RuntimeTargetId,
      namespace: 'tenant-a',
      status: 'completed',
      input: {},
      completedSteps: {},
      fingerprint: [],
      pendingSuspends: [],
      updatedAt: new Date('2026-07-01T00:00:00.000Z'),
    })
    await expect(
      store.state.pruneTerminalSnapshots({
        namespace: 'tenant-a',
        before: cutoff,
        limit: 10,
      }),
    ).resolves.toEqual({ removed: 1, truncated: false })
    await expect(
      store.state.getSnapshot('flow_live' as FlowId, {
        namespace: 'tenant-a',
      }),
    ).resolves.toMatchObject({ status: 'suspended' })

    await store.state.putIdempotencyKey({
      namespace: 'tenant-a',
      key: 'old-key',
      completedAt: new Date('2026-07-01T00:00:00.000Z'),
    })
    await expect(
      store.state.pruneIdempotencyKeys({
        namespace: 'tenant-a',
        before: cutoff,
        limit: 10,
      }),
    ).resolves.toEqual({ removed: 1, truncated: false })
    await expect(
      store.state.hasIdempotencyKey('tenant-a', 'old-key'),
    ).resolves.toBe(false)

    const scheduled = await store.timers.put({
      namespace: 'tenant-a',
      fireAt: new Date('2026-07-01T00:00:00.000Z'),
      work: {
        kind: 'task.run',
        taskId: 'task_timer_live' as TaskId,
        targetId: 'review' as RuntimeTargetId,
      },
    })
    const fired = await store.timers.put({
      namespace: 'tenant-a',
      fireAt: new Date('2026-07-01T00:00:00.000Z'),
      work: {
        kind: 'task.run',
        taskId: 'task_timer_done' as TaskId,
        targetId: 'review' as RuntimeTargetId,
      },
    })
    await store.timers.transition(fired.timerId, 'scheduled', 'fired')
    await expect(
      store.timers.prune({ namespace: 'tenant-a', before: cutoff, limit: 10 }),
    ).resolves.toEqual({ removed: 1, truncated: false })
    await expect(store.timers.get(scheduled.timerId)).resolves.toMatchObject({
      state: 'scheduled',
    })
    await expect(store.timers.get(fired.timerId)).resolves.toBeNull()

    const armed = await store.waiters.register({
      namespace: 'tenant-a',
      eventName: 'approval',
      match: {},
      work: { kind: 'flow.resume', flowId: 'flow_live' as FlowId },
    })
    const timedOut = await store.waiters.register({
      namespace: 'tenant-a',
      eventName: 'approval',
      match: {},
      work: { kind: 'flow.resume', flowId: 'flow_done' as FlowId },
    })
    await store.waiters.transition(timedOut.waiterId, 'armed', 'timed-out')
    await expect(
      store.waiters.prune({ namespace: 'tenant-a', before: cutoff, limit: 10 }),
    ).resolves.toEqual({ removed: 1, truncated: false })
    await expect(
      store.waiters.transition(armed.waiterId, 'armed', 'cancelled'),
    ).resolves.toBe(true)

    const pendingOutbox = await store.outbox.put({
      v: 1,
      ns: 'tenant-a',
      workId: 'work_pending' as WorkId,
      target: 'review' as RuntimeTargetId,
      kind: 'task.run',
      idempotencyKey: 'pending',
      attempt: 1,
    })
    const confirmedOutbox = await store.outbox.put({
      v: 1,
      ns: 'tenant-a',
      workId: 'work_completed' as WorkId,
      target: 'review' as RuntimeTargetId,
      kind: 'task.run',
      idempotencyKey: 'confirmed',
      attempt: 1,
    })
    await store.outbox.confirm(confirmedOutbox.outboxId)
    await expect(
      store.outbox.prune({ namespace: 'tenant-a', before: cutoff, limit: 10 }),
    ).resolves.toEqual({ removed: 1, truncated: false })
    await expect(store.outbox.get(pendingOutbox.outboxId)).resolves.toMatchObject(
      { state: 'pending' },
    )
    await expect(store.outbox.get(confirmedOutbox.outboxId)).resolves.toBeNull()

    await expect(
      store.events.read({ namespace: 'tenant-b' }),
    ).resolves.toMatchObject({
      events: [expect.objectContaining({ name: 'other' })],
    })
  })
}
