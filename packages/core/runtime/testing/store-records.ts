import { expect, it } from 'vitest'
import { DEFAULT_RUNTIME_MAX_ATTEMPTS } from '../engine/retry'
import type {
  EventCursor,
  FlowId,
  RuntimeTargetId,
  TaskId,
  WaiterId,
  WorkId,
} from '../ports'
import type { RuntimeStoreAdapter } from '../store'
import { makeConformanceWorkItem } from './store-fixtures'
import type { RunStoreAdapterTestsOptions } from './store-types'

export function registerStoreRecordTests<TStore extends RuntimeStoreAdapter>(
  options: RunStoreAdapterTestsOptions<TStore>,
): void {
  it('invariant: durable events support cursor reads and duplicate idempotency', async () => {
    const store = await options.createStore()
    const payload = { documentId: 'doc_1', nested: { approved: true } }

    const first = await store.events.append({
      namespace: 'tenant-a',
      name: 'document.approved',
      payload,
      eventId: 'evt_document_approved',
    })
    payload.nested.approved = false

    const duplicate = await store.events.append({
      namespace: 'tenant-a',
      name: 'document.changed',
      payload: { ignored: true },
      eventId: first.eventId,
    })
    const second = await store.events.append({
      namespace: 'tenant-a',
      name: 'document.archived',
      payload: { documentId: 'doc_1' },
    })
    await store.events.append({
      namespace: 'tenant-b',
      name: 'document.approved',
      payload: { documentId: 'doc_2' },
    })

    expect(duplicate).toEqual(first)
    await expect(store.events.read({ namespace: 'tenant-a' })).resolves.toEqual(
      {
        events: [
          expect.objectContaining({
            eventId: first.eventId,
            name: 'document.approved',
            payload: { documentId: 'doc_1', nested: { approved: true } },
          }),
          expect.objectContaining({
            eventId: second.eventId,
            name: 'document.archived',
          }),
        ],
        cursor: second.eventId,
      },
    )
    await expect(
      store.events.read({ namespace: 'tenant-a', after: first.eventId }),
    ).resolves.toEqual({
      events: [expect.objectContaining({ eventId: second.eventId })],
      cursor: second.eventId,
    })
  })

  it('invariant: state records are cloned and namespace isolated', async () => {
    const store = await options.createStore()
    const work = makeConformanceWorkItem()

    await store.state.putWork(work)
    const readWork = await store.state.getWork(work.workId, {
      namespace: 'tenant-a',
    })
    expect(readWork).toEqual(work)
    expect(Object.isFrozen(readWork)).toBe(true)
    await expect(
      store.state.getWork(work.workId, { namespace: 'tenant-b' }),
    ).resolves.toBeNull()

    await store.state.putSnapshot({
      flowId: 'flow_1' as FlowId,
      workId: 'work_flow_1' as WorkId,
      targetId: 'review' as RuntimeTargetId,
      namespace: 'tenant-a',
      status: 'suspended',
      input: { documentId: 'doc_1' },
      completedSteps: { load: { ok: true } },
      fingerprint: ['step:load', 'suspend:approval'],
      pendingSuspends: [
        { label: 'approval', waiterId: 'waiter_1' as WaiterId },
      ],
      updatedAt: new Date('2026-07-02T00:00:00.000Z'),
    })
    await store.state.markSnapshotDelivered('work_flow_1' as WorkId, {
      namespace: 'tenant-a',
      waiterId: 'waiter_1' as WaiterId,
      eventId: 'evt_1' as EventCursor,
    })
    const snapshot = await store.state.getSnapshot('flow_1' as FlowId, {
      namespace: 'tenant-a',
    })
    expect(snapshot?.completedSteps).toEqual({ load: { ok: true } })
    expect(snapshot?.pendingSuspends).toEqual([
      {
        label: 'approval',
        waiterId: 'waiter_1',
        delivered: { eventId: 'evt_1' },
      },
    ])
    ;(
      snapshot as unknown as { completedSteps: { load: { ok: boolean } } }
    ).completedSteps.load.ok = false
    await expect(
      store.state.getSnapshot('flow_1' as FlowId, { namespace: 'tenant-a' }),
    ).resolves.toMatchObject({ completedSteps: { load: { ok: true } } })

    await expect(
      store.state.hasIdempotencyKey('tenant-a', 'resume:work_1:event_1'),
    ).resolves.toBe(false)
    await store.state.putIdempotencyKey({
      namespace: 'tenant-a',
      key: 'resume:work_1:event_1',
      completedAt: new Date('2026-07-02T00:01:00.000Z'),
    })
    await expect(
      store.state.hasIdempotencyKey('tenant-a', 'resume:work_1:event_1'),
    ).resolves.toBe(true)
    await expect(
      store.state.hasIdempotencyKey('tenant-b', 'resume:work_1:event_1'),
    ).resolves.toBe(false)
  })

  it('invariant: work composites create new work and resume existing suspended work only once', async () => {
    const store = await options.createStore()
    const created = await store.state.createWork({
      workId: 'work_task_1' as WorkId,
      namespace: 'tenant-a',
      work: {
        kind: 'task.run',
        taskId: 'task_1' as TaskId,
        targetId: 'embed-document' as RuntimeTargetId,
      },
      targetId: 'embed-document' as RuntimeTargetId,
      idempotencyKey: 'task:work_task_1',
    })
    expect(created).toMatchObject({
      workId: 'work_task_1',
      status: 'pending',
      attempt: 1,
      maxAttempts: DEFAULT_RUNTIME_MAX_ATTEMPTS,
    })

    const suspended = makeConformanceWorkItem({
      workId: 'work_flow_1' as WorkId,
      work: { kind: 'flow.resume', flowId: 'flow_1' as FlowId },
      status: 'suspended',
      attempt: 4,
      notBefore: new Date('2026-07-02T00:01:00.000Z'),
      lastError: {
        code: 'WORK_DEAD_LETTERED',
        message: 'previous failure',
        at: new Date('2026-07-02T00:00:30.000Z'),
      },
    })
    await store.state.putWork(suspended)

    const resumed = await store.state.setWorkPending('work_flow_1' as WorkId, {
      namespace: 'tenant-a',
      work: {
        kind: 'flow.timeout',
        flowId: 'flow_1' as FlowId,
        suspendPoint: 'approval',
      },
      idempotencyKey: 'timer:timer_1',
    })
    expect(resumed).toMatchObject({
      workId: 'work_flow_1',
      status: 'pending',
      attempt: 1,
      idempotencyKey: 'timer:timer_1',
      work: {
        kind: 'flow.timeout',
        flowId: 'flow_1',
        suspendPoint: 'approval',
      },
    })
    expect(resumed?.notBefore).toBeUndefined()
    expect(resumed?.lastError).toBeUndefined()

    await store.state.putWork({ ...resumed!, status: 'completed' })
    await expect(
      store.state.setWorkPending('work_flow_1' as WorkId, {
        namespace: 'tenant-a',
        work: { kind: 'flow.resume', flowId: 'flow_1' as FlowId },
        idempotencyKey: 'resume:work_flow_1:evt_2',
      }),
    ).resolves.toBeNull()

    const blocked = makeConformanceWorkItem({
      workId: 'work_blocked_1' as WorkId,
      status: 'blocked',
      attempt: DEFAULT_RUNTIME_MAX_ATTEMPTS,
      lastError: {
        code: 'WORK_DEAD_LETTERED',
        message: 'previous failure',
        at: new Date('2026-07-02T00:00:30.000Z'),
      },
    })
    await store.state.putWork(blocked)
    await expect(
      store.state.setWorkPending('work_blocked_1' as WorkId, {
        namespace: 'tenant-a',
        work: { kind: 'flow.resume', flowId: 'flow_1' as FlowId },
        idempotencyKey: 'retry:work_blocked_1',
      }),
    ).resolves.toBeNull()
    await expect(
      store.state.setWorkPending('work_blocked_1' as WorkId, {
        namespace: 'tenant-a',
        work: { kind: 'flow.resume', flowId: 'flow_1' as FlowId },
        idempotencyKey: 'retry:work_blocked_1',
        from: ['blocked', 'dead-letter'],
      }),
    ).resolves.toMatchObject({
      status: 'pending',
      attempt: 1,
      idempotencyKey: 'retry:work_blocked_1',
    })
  })

  it('invariant: work listing and idle counters are namespace-scoped and bounded', async () => {
    const store = await options.createStore()
    await store.state.createWork({
      workId: 'work_idle_1' as WorkId,
      namespace: 'tenant-a',
      work: {
        kind: 'task.run',
        taskId: 'task_1' as TaskId,
        targetId: 'embed-document' as RuntimeTargetId,
      },
      targetId: 'embed-document' as RuntimeTargetId,
      idempotencyKey: 'task:work_idle_1',
      idleScope: 'flow:flow_1',
      now: new Date('2026-07-02T00:00:00.000Z'),
    })
    await store.state.putWork(
      makeConformanceWorkItem({
        workId: 'work_old_1' as WorkId,
        status: 'leased',
        updatedAt: new Date('2026-07-02T00:00:00.000Z'),
      }),
    )
    await store.state.putWork(
      makeConformanceWorkItem({
        workId: 'work_new_1' as WorkId,
        status: 'leased',
        updatedAt: new Date('2026-07-02T00:01:00.000Z'),
      }),
    )
    await store.state.putWork(
      makeConformanceWorkItem({
        workId: 'work_other_tenant_1' as WorkId,
        namespace: 'tenant-b',
        status: 'leased',
        updatedAt: new Date('2026-07-02T00:00:00.000Z'),
      }),
    )

    await expect(
      store.state.listWork({
        namespace: 'tenant-a',
        status: 'leased',
        updatedBefore: new Date('2026-07-02T00:00:30.000Z'),
        limit: 1,
      }),
    ).resolves.toEqual([expect.objectContaining({ workId: 'work_old_1' })])
    await expect(
      store.state.getIdleCount('tenant-a', 'flow:flow_1'),
    ).resolves.toBe(1)
    await expect(
      store.state.incrementIdle('tenant-a', 'flow:flow_1'),
    ).resolves.toBe(2)
    await expect(
      store.state.decrementIdle('tenant-a', 'flow:flow_1'),
    ).resolves.toBe(1)
    await expect(
      store.state.decrementIdle('tenant-a', 'flow:flow_1'),
    ).resolves.toBe(0)
    await expect(
      store.state.decrementIdle('tenant-a', 'flow:flow_1'),
    ).rejects.toThrow('went negative')
  })
}
