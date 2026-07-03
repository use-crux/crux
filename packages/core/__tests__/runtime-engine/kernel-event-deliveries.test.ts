import { describe, expect, it } from 'vitest'
import { inMemoryRuntimeStore } from '../../runtime/adapters/memory'
import type { FlowId, RuntimeTargetId, WorkId } from '../../runtime/ports'
import { createRuntimeKernel } from '../../runtime/engine/kernel'
import type { WorkItem } from '../../runtime/engine/work'

describe('RuntimeKernel event delivery recording', () => {
  it('records every won waiter delivery when multiple events arrive before replay', async () => {
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
        fingerprint: ['suspend:approval', 'suspend:legal'],
      },
      suspends: [
        {
          label: 'approval',
          eventName: 'document.approved',
          match: { documentId: 'doc_1' },
        },
        {
          label: 'legal',
          eventName: 'document.legal-cleared',
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
      kernel.emitEvent({
        namespace: 'tenant-a',
        name: 'document.legal-cleared',
        payload: { documentId: 'doc_1' },
      }),
    ).resolves.toMatchObject({ outboxItems: [expect.any(Object)] })

    await expect(
      store.state.getSnapshot('flow_1' as FlowId, { namespace: 'tenant-a' }),
    ).resolves.toMatchObject({
      pendingSuspends: [
        {
          label: 'approval',
          delivered: { eventId: 'evt_1' },
        },
        {
          label: 'legal',
          delivered: { eventId: 'evt_2' },
        },
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
