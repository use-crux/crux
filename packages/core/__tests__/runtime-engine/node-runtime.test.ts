import { afterEach, describe, expect, it } from 'vitest'
import {
  CruxRuntimeError,
  bindHostRuntime,
  createRuntime,
  inMemoryRuntimeStore,
  node,
  runWithRuntimeHost,
  task,
  type FlowId,
  type HostBoundRuntimeEngineDefinition,
  type RuntimeTargetId,
  type TaskId,
  type WorkId,
  type WorkItem,
} from '@use-crux/core/runtime'
import { config, resetRuntime } from '@use-crux/core'
import { flow } from '@use-crux/core/flow'

afterEach(() => {
  resetRuntime()
})

describe('node() Runtime Engine composer', () => {
  it('rejects host-bound runtime declarations outside their host boundary', () => {
    const runtimeDefinition: HostBoundRuntimeEngineDefinition = {
      kind: 'host-bound',
      id: 'convex',
      host: 'convex',
      capabilities: node({ autoStartMaintenance: false }).capabilities,
      entry: 'createConvexRuntimeHandlers({ targetExecutor }) in convex/_crux/generated.ts',
    }

    expect(() =>
      createRuntime({
        runtime: runtimeDefinition,
        targets: {},
        startMaintenance: false,
      }),
    ).toThrowError(CruxRuntimeError)
    expect(() =>
      createRuntime({
        runtime: runtimeDefinition,
        targets: {},
        startMaintenance: false,
      }),
    ).toThrowError(/RUNTIME_HOST_ONLY/)
  })

  it('runs configured host-bound flows inside an active host binding', async () => {
    const hostRuntimeDefinition: HostBoundRuntimeEngineDefinition = {
      kind: 'host-bound',
      id: 'test-host',
      host: 'test-host',
      capabilities: node({ autoStartMaintenance: false }).capabilities,
      entry: 'testHost.run()',
    }
    config({ runtime: hostRuntimeDefinition })

    const reviewFlow = flow('host-bound-review', async (scope, input: { documentId: string }) => {
      return await scope.step('echo', () => input.documentId)
    })

    await expect(reviewFlow.run({ documentId: 'doc_1' })).rejects.toThrowError(/RUNTIME_HOST_ONLY/)

    await expect(
      runWithRuntimeHost(
        {
          host: 'test-host',
          bind: (definition, options) =>
            bindHostRuntime(definition, {
              ...options,
              store: inMemoryRuntimeStore(),
              createWake: () => async () => undefined,
              startMaintenance: false,
            }),
        },
        () => reviewFlow.run({ documentId: 'doc_1' }),
      ),
    ).resolves.toMatchObject({ status: 'completed', output: 'doc_1' })
  })

  it('runs executable runtime task targets with persisted JSON input', async () => {
    let nextWork = 0
    const runtimeDefinition = node({
      namespace: 'tenant-a',
      autoStartMaintenance: false,
    })
    const seenInputs: unknown[] = []
    const embedDocument = task('embed-document', {
      run: async (input: { documentId: string }) => {
        seenInputs.push(input)
      },
    })
    const runtime = createRuntime({
      runtime: runtimeDefinition,
      targets: { [embedDocument.name]: embedDocument },
      newWorkId: () => `work_task_${++nextWork}` as WorkId,
    })

    await runtime.kernel.enqueueTask({
      namespace: 'tenant-a',
      taskId: 'task_1' as TaskId,
      targetId: embedDocument.targetId,
      input: { documentId: 'doc_1' },
    })
    await runtime.dispatcher.nudge()

    expect(seenInputs).toEqual([{ documentId: 'doc_1' }])
    runtime.dispose()
  })

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

    await expect(runtime.store.state.getWork(task.workId, { namespace: 'tenant-a' })).resolves.toMatchObject({
      status: 'completed',
    })
    await expect(runtime.store.state.getIdleCount('tenant-a', 'flow:flow_task_parent')).resolves.toBe(0)

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

    await runtime.store.state.putWork(makeFlowWork('work_flow_timeout_1', 'flow_timeout_1' as FlowId))
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

    await runtime.store.state.putWork(makeFlowWork('work_flow_cancel_1', 'flow_cancel_1' as FlowId))
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
    await expect(runtime.store.events.read({ namespace: 'tenant-a' })).resolves.toMatchObject({
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

function makeFlowWork(workId: string, flowId: FlowId = 'flow_event_1' as FlowId): WorkItem {
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
