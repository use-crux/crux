import { describe, expect, it } from 'vitest'
import { inMemoryRuntimeStore } from '../../src/runtime/adapters/memory'
import type {
  FlowId,
  RuntimeTargetId,
  WaiterId,
  WorkId,
} from '../../src/runtime/ports'
import { createRuntimeKernel } from '../../src/runtime/engine/kernel'
import type { WorkItem } from '../../src/runtime/engine/work'

describe('RuntimeKernel event and suspension composites', () => {
  it('records a suspension by parking the existing flow work and registering owned waiters', async () => {
    const store = inMemoryRuntimeStore()
    const kernel = createRuntimeKernel({
      store,
      targets: {},
      newWorkId: () => 'unused' as WorkId,
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
        },
      ],
    })

    await expect(
      store.state.getWork('work_flow_1' as WorkId, { namespace: 'tenant-a' }),
    ).resolves.toMatchObject({ status: 'suspended' })
    await expect(
      store.waiters.resolve(
        'document.approved',
        { documentId: 'doc_1' },
        {
          namespace: 'tenant-a',
        },
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        workId: 'work_flow_1',
        work: { kind: 'flow.resume', flowId: 'flow_1' },
      }),
    ])
  })

  it('emits events by firing waiters and resuming the existing flow work item', async () => {
    const store = inMemoryRuntimeStore()
    const kernel = createRuntimeKernel({
      store,
      targets: {},
      newWorkId: () => 'unused' as WorkId,
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
        },
      ],
    })

    await expect(
      kernel.emitEvent({
        namespace: 'tenant-a',
        name: 'document.approved',
        payload: { documentId: 'doc_1' },
      }),
    ).resolves.toMatchObject({ outboxItems: [expect.any(Object)] })
    await expect(
      store.state.getWork('work_flow_1' as WorkId, { namespace: 'tenant-a' }),
    ).resolves.toMatchObject({
      status: 'pending',
      attempt: 1,
      idempotencyKey: 'resume:work_flow_1:evt_1',
    })
    await expect(
      store.state.getSnapshot('flow_1' as FlowId, { namespace: 'tenant-a' }),
    ).resolves.toMatchObject({
      pendingSuspends: [
        {
          label: 'approval',
          delivered: {
            eventId: 'evt_1',
            payload: { documentId: 'doc_1' },
          },
        },
      ],
    })
  })

  it('emits events with zero or many matching waiters', async () => {
    const store = inMemoryRuntimeStore()
    const kernel = createRuntimeKernel({
      store,
      targets: {},
      newWorkId: () => 'unused' as WorkId,
    })

    await expect(
      kernel.emitEvent({
        namespace: 'tenant-a',
        name: 'document.approved',
        payload: { documentId: 'missing' },
      }),
    ).resolves.toMatchObject({ outboxItems: [] })

    await store.state.putWork(makeFlowWork({ status: 'leased' }))
    await store.state.putWork(
      makeFlowWork({
        workId: 'work_flow_2' as WorkId,
        work: { kind: 'flow.resume', flowId: 'flow_2' as FlowId },
        status: 'leased',
      }),
    )
    await kernel.recordSuspension({
      namespace: 'tenant-a',
      workId: 'work_flow_1' as WorkId,
      flowId: 'flow_1' as FlowId,
      targetId: 'review' as RuntimeTargetId,
      snapshot: { input: {}, completedSteps: {}, fingerprint: [] },
      suspends: [
        { label: 'approval', eventName: 'document.approved', match: {} },
      ],
    })
    await kernel.recordSuspension({
      namespace: 'tenant-a',
      workId: 'work_flow_2' as WorkId,
      flowId: 'flow_2' as FlowId,
      targetId: 'review' as RuntimeTargetId,
      snapshot: { input: {}, completedSteps: {}, fingerprint: [] },
      suspends: [
        { label: 'approval', eventName: 'document.approved', match: {} },
      ],
    })

    await expect(
      kernel.emitEvent({
        namespace: 'tenant-a',
        name: 'document.approved',
        payload: { documentId: 'doc_1' },
      }),
    ).resolves.toMatchObject({
      outboxItems: [expect.any(Object), expect.any(Object)],
    })
    await expect(
      store.state.getWork('work_flow_1' as WorkId, { namespace: 'tenant-a' }),
    ).resolves.toMatchObject({ status: 'pending' })
    await expect(
      store.state.getWork('work_flow_2' as WorkId, { namespace: 'tenant-a' }),
    ).resolves.toMatchObject({ status: 'pending' })
  })

  it('resolves concurrent duplicate emits through one waiter CAS winner', async () => {
    const store = inMemoryRuntimeStore()
    const kernel = createRuntimeKernel({
      store,
      targets: {},
      newWorkId: () => 'unused' as WorkId,
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
        },
      ],
    })

    await Promise.all([
      kernel.emitEvent({
        namespace: 'tenant-a',
        name: 'document.approved',
        payload: { documentId: 'doc_1' },
        eventId: 'evt_external',
      }),
      kernel.emitEvent({
        namespace: 'tenant-a',
        name: 'document.approved',
        payload: { documentId: 'doc_1' },
        eventId: 'evt_external',
      }),
    ])

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
