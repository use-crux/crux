import { describe, expect, it } from 'vitest'
import {
  createRuntime,
  node,
  type FlowId,
  type RuntimeTargetId,
  type TaskId,
  type WorkId,
  type WorkItem,
} from '@use-crux/core/runtime'

describe('node() Runtime Engine composer', () => {
  it('runs task, event, timer, cancellation, and scoped-idle paths in-process', async () => {
    let nextWork = 0
    const flowRuns: string[] = []
    const runtimeDefinition = node({
      namespace: 'tenant-a',
      autoStartMaintenance: false,
    })
    const runtime = createRuntime({
      runtime: runtimeDefinition,
      targets: {
        'embed-document': {
          targetId: 'embed-document' as RuntimeTargetId,
          kind: 'task',
          execute: async ({ work }) => {
            await runtimeDefinition.store.events.append({
              namespace: work.namespace,
              name: 'task.executed',
              payload: { workId: work.workId },
            })
            return { status: 'completed' }
          },
        },
        review: {
          targetId: 'review' as RuntimeTargetId,
          kind: 'flow',
          execute: async ({ work }) => {
            flowRuns.push(work.work.kind)
            return { status: 'completed' }
          },
        },
      },
      newWorkId: () => `work_task_${++nextWork}` as WorkId,
    })

    const task = await runtime.kernel.enqueueTask({
      namespace: 'tenant-a',
      taskId: 'task_1' as TaskId,
      targetId: 'embed-document' as RuntimeTargetId,
      idleScope: 'flow:flow_task_parent',
    })
    await runtime.dispatcher.nudge()

    await expect(
      runtime.store.state.getWork(task.workId, { namespace: 'tenant-a' }),
    ).resolves.toMatchObject({ status: 'completed' })
    await expect(
      runtime.store.state.getIdleCount('tenant-a', 'flow:flow_task_parent'),
    ).resolves.toBe(0)

    await runtime.store.state.putWork(makeFlowWork('work_flow_event_1'))
    await runtime.kernel.recordSuspension({
      namespace: 'tenant-a',
      workId: 'work_flow_event_1' as WorkId,
      flowId: 'flow_event_1' as FlowId,
      targetId: 'review' as RuntimeTargetId,
      snapshot: { input: {}, completedSteps: {}, fingerprint: [] },
      suspends: [
        {
          label: 'approval',
          eventName: 'document.approved',
          match: { documentId: 'doc_1' },
        },
      ],
    })
    await runtime.kernel.emitEvent({
      namespace: 'tenant-a',
      name: 'document.approved',
      payload: { documentId: 'doc_1' },
    })
    await runtime.dispatcher.nudge()

    await runtime.store.state.putWork(
      makeFlowWork('work_flow_timeout_1', 'flow_timeout_1' as FlowId),
    )
    await runtime.kernel.recordSuspension({
      namespace: 'tenant-a',
      workId: 'work_flow_timeout_1' as WorkId,
      flowId: 'flow_timeout_1' as FlowId,
      targetId: 'review' as RuntimeTargetId,
      snapshot: { input: {}, completedSteps: {}, fingerprint: [] },
      suspends: [
        {
          label: 'approval',
          eventName: 'document.timeout',
          match: {},
          timeoutAt: new Date('2026-07-02T00:00:10.000Z'),
        },
      ],
    })
    await runtime.maintenance.tick({
      now: new Date('2026-07-02T00:00:10.000Z'),
    })
    await runtime.dispatcher.nudge()

    expect(flowRuns).toEqual(['flow.resume', 'flow.timeout'])

    await runtime.store.state.putWork(
      makeFlowWork('work_flow_cancel_1', 'flow_cancel_1' as FlowId),
    )
    await runtime.kernel.recordSuspension({
      namespace: 'tenant-a',
      workId: 'work_flow_cancel_1' as WorkId,
      flowId: 'flow_cancel_1' as FlowId,
      targetId: 'review' as RuntimeTargetId,
      snapshot: { input: {}, completedSteps: {}, fingerprint: [] },
      suspends: [
        {
          label: 'approval',
          eventName: 'document.cancel',
          match: {},
          timeoutAt: new Date('2026-07-02T00:01:00.000Z'),
        },
      ],
    })

    await expect(
      runtime.kernel.cancelWork({
        namespace: 'tenant-a',
        workId: 'work_flow_cancel_1' as WorkId,
      }),
    ).resolves.toEqual({ cancelled: true })
    await expect(
      runtime.store.state.getWork('work_flow_cancel_1' as WorkId, {
        namespace: 'tenant-a',
      }),
    ).resolves.toMatchObject({ status: 'cancelled' })
    await expect(runtime.store.events.read({ namespace: 'tenant-a' })).resolves
      .toMatchObject({
        events: expect.arrayContaining([
          expect.objectContaining({ name: 'task.executed' }),
          expect.objectContaining({
            name: 'crux.idle:flow:flow_task_parent',
          }),
          expect.objectContaining({
            name: 'crux.cancelled:work_flow_cancel_1',
          }),
        ]),
      })

    runtime.dispose()
  })
})

function makeFlowWork(
  workId: string,
  flowId: FlowId = 'flow_event_1' as FlowId,
): WorkItem {
  const now = new Date('2026-07-02T00:00:00.000Z')
  return {
    workId: workId as WorkId,
    namespace: 'tenant-a',
    work: { kind: 'flow.resume', flowId },
    targetId: 'review' as RuntimeTargetId,
    status: 'leased',
    attempt: 1,
    maxAttempts: 8,
    idempotencyKey: `resume:${workId}:start`,
    createdAt: now,
    updatedAt: now,
  }
}
