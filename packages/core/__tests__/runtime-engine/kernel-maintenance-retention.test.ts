import { afterEach, describe, expect, it } from 'vitest'
import { config, flow } from '@use-crux/core'
import { createRuntime, node } from '@use-crux/core/runtime'
import { inMemoryRuntimeStore } from '../../runtime/adapters/memory'
import { createRuntimeKernel } from '../../runtime/engine/kernel'
import type { WorkItem } from '../../runtime/engine/work'
import { runtimeTargetMap } from '../../runtime/api/target-registry'
import type {
  FlowId,
  RuntimeTargetId,
  WorkId,
} from '../../runtime/ports'
import { resetHooks } from '../../runtime/runtime'

describe('RuntimeKernel retention maintenance', () => {
  afterEach(() => {
    resetHooks()
  })

  it('prunes terminal records created by a real runtime-backed flow', async () => {
    let now = new Date('2026-07-02T00:00:00.000Z')
    let nextWork = 0
    const store = inMemoryRuntimeStore()
    const runtimeDefinition = Object.freeze({
      ...node({
        store,
        namespace: 'tenant-a',
        autoStartMaintenance: false,
        retention: {
          events: '1ms',
          terminalWork: '1ms',
          terminalSnapshots: '1ms',
          idempotencyKeys: '1ms',
          sweepLimit: 50,
        },
      }),
      now: () => now,
      newWorkId: () => `work_retention_${++nextWork}` as WorkId,
    })
    const crux = config({ runtime: runtimeDefinition })
    const reviewFlow = flow('retention-real-flow', async (scope, input: { documentId: string }) => {
      await scope.suspend('approval')
      return input.documentId
    })
    const runtimeRef = {}
    const runtime = createRuntime({
      runtime: runtimeDefinition,
      targets: runtimeTargetMap(runtimeRef),
      leaseExtension: false,
      startMaintenance: false,
    })
    Object.assign(runtimeRef, { current: runtime })

    try {
      const suspended = await reviewFlow.run({ documentId: 'doc_1' })
      await reviewFlow.signal(suspended.flowId, 'approval', {}, { resume: false })
      await expect(reviewFlow.resume(suspended.flowId)).resolves.toMatchObject({
        status: 'completed',
        output: 'doc_1',
      })
      const snapshot = await store.state.getSnapshot(suspended.flowId as FlowId, {
        namespace: 'tenant-a',
      })
      expect(snapshot).toMatchObject({ status: 'completed' })
      const workId = snapshot!.workId as WorkId
      await expect(store.state.getWork(workId, { namespace: 'tenant-a' })).resolves.toMatchObject({
        status: 'completed',
      })

      now = new Date('2999-01-02T00:00:00.000Z')
      await expect(runtime.maintenance.tick({ now })).resolves.toMatchObject({
        retentionTruncated: false,
      })
      await expect(
        store.state.getSnapshot(suspended.flowId as FlowId, {
          namespace: 'tenant-a',
        }),
      ).resolves.toBeNull()
      await expect(store.state.getWork(workId, { namespace: 'tenant-a' })).resolves.toBeNull()
    } finally {
      runtime.dispose()
      crux.dispose()
    }
  })

  it('prunes retained terminal records while preserving live runtime records', async () => {
    const store = inMemoryRuntimeStore()
    const now = new Date('2999-01-02T00:00:00.000Z')
    const kernel = createRuntimeKernel({
      store,
      targets: {},
      newWorkId: () => 'unused' as WorkId,
      now: () => now,
      retention: {
        events: '1ms',
        terminalWork: '1ms',
        confirmedOutbox: '1ms',
        idempotencyKeys: '1ms',
        settledTimers: '1ms',
        settledWaiters: '1ms',
        terminalSnapshots: '1ms',
        sweepLimit: 50,
      },
    })

    await store.events.append({
      namespace: 'tenant-a',
      name: 'document.approved',
      payload: { documentId: 'doc_1' },
    })
    await store.state.putWork(makeFlowWork({ status: 'completed' }))
    await store.state.putWork(
      makeFlowWork({
        workId: 'work_live_1' as WorkId,
        status: 'suspended',
      }),
    )
    await store.state.putSnapshot({
      flowId: 'flow_done_1' as FlowId,
      workId: 'work_flow_1' as WorkId,
      targetId: 'review' as RuntimeTargetId,
      namespace: 'tenant-a',
      status: 'completed',
      input: {},
      completedSteps: {},
      fingerprint: [],
      pendingSuspends: [],
      updatedAt: new Date('2026-07-01T00:00:00.000Z'),
    })
    await store.state.putSnapshot({
      flowId: 'flow_live_1' as FlowId,
      workId: 'work_live_1' as WorkId,
      targetId: 'review' as RuntimeTargetId,
      namespace: 'tenant-a',
      status: 'suspended',
      input: {},
      completedSteps: {},
      fingerprint: [],
      pendingSuspends: [],
      updatedAt: new Date('2026-07-01T00:00:00.000Z'),
    })
    await store.state.putIdempotencyKey({
      namespace: 'tenant-a',
      key: 'done-key',
      completedAt: new Date('2026-07-01T00:00:00.000Z'),
    })

    const firedTimer = await store.timers.put({
      namespace: 'tenant-a',
      fireAt: new Date('2026-07-01T00:00:00.000Z'),
      work: { kind: 'flow.resume', flowId: 'flow_done_1' as FlowId },
    })
    await store.timers.transition(firedTimer.timerId, 'scheduled', 'fired')
    const liveTimer = await store.timers.put({
      namespace: 'tenant-a',
      fireAt: new Date('2999-01-03T00:00:00.000Z'),
      work: { kind: 'flow.resume', flowId: 'flow_live_1' as FlowId },
    })

    const timedOutWaiter = await store.waiters.register({
      namespace: 'tenant-a',
      eventName: 'done',
      match: {},
      work: { kind: 'flow.resume', flowId: 'flow_done_1' as FlowId },
    })
    await store.waiters.transition(timedOutWaiter.waiterId, 'armed', 'timed-out')
    const liveWaiter = await store.waiters.register({
      namespace: 'tenant-a',
      eventName: 'live',
      match: {},
      work: { kind: 'flow.resume', flowId: 'flow_live_1' as FlowId },
      timeoutAt: new Date('2999-01-03T00:00:00.000Z'),
    })

    const confirmedOutbox = await store.outbox.put({
      v: 1,
      ns: 'tenant-a',
      workId: 'work_flow_1' as WorkId,
      target: 'review' as RuntimeTargetId,
      kind: 'flow.resume',
      idempotencyKey: 'done',
      attempt: 1,
    })
    await store.outbox.confirm(confirmedOutbox.outboxId)
    const pendingOutbox = await store.outbox.put({
      v: 1,
      ns: 'tenant-a',
      workId: 'work_live_1' as WorkId,
      target: 'review' as RuntimeTargetId,
      kind: 'flow.resume',
      idempotencyKey: 'live',
      attempt: 1,
    })

    await expect(
      kernel.maintenanceTick({ namespace: 'tenant-a', now }),
    ).resolves.toMatchObject({
      retainedRecordsRemoved: 7,
      retentionTruncated: false,
    })

    await expect(
      store.events.read({ namespace: 'tenant-a' }),
    ).resolves.toMatchObject({ events: [] })
    await expect(
      store.state.getWork('work_flow_1' as WorkId, { namespace: 'tenant-a' }),
    ).resolves.toBeNull()
    await expect(
      store.state.getSnapshot('flow_done_1' as FlowId, {
        namespace: 'tenant-a',
      }),
    ).resolves.toBeNull()
    await expect(
      store.state.hasIdempotencyKey('tenant-a', 'done-key'),
    ).resolves.toBe(false)
    await expect(store.timers.get(firedTimer.timerId)).resolves.toBeNull()
    await expect(
      store.waiters.transition(timedOutWaiter.waiterId, 'timed-out', 'cancelled'),
    ).resolves.toBe(false)
    await expect(store.outbox.get(confirmedOutbox.outboxId)).resolves.toBeNull()

    await expect(
      store.state.getWork('work_live_1' as WorkId, { namespace: 'tenant-a' }),
    ).resolves.toMatchObject({ status: 'suspended' })
    await expect(
      store.state.getSnapshot('flow_live_1' as FlowId, {
        namespace: 'tenant-a',
      }),
    ).resolves.toMatchObject({ status: 'suspended' })
    await expect(store.timers.get(liveTimer.timerId)).resolves.toMatchObject({
      state: 'scheduled',
    })
    await expect(
      store.waiters.transition(liveWaiter.waiterId, 'armed', 'cancelled'),
    ).resolves.toBe(true)
    await expect(store.outbox.get(pendingOutbox.outboxId)).resolves.toMatchObject(
      { state: 'pending' },
    )
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
