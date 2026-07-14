import { afterEach, describe, expect, it } from 'vitest'
import { config, flow } from '@use-crux/core'
import {
  createRuntime,
  node,
  durableTask,
  type FlowId,
  type RuntimeTargetId,
  type WorkId,
} from '@use-crux/core/runtime'
import { runtimeTargetMap } from '../../src/runtime/api/target-registry'
import { getExecutionContext } from '../../src/runtime/execution-context'
import { resetHooks } from '../../src/runtime/runtime'
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from '../../src/observability'

afterEach(() => {
  resetHooks()
  resetObservabilityRuntime()
})

describe('runtime-backed flows', () => {
  it('flushes flow.defer at a suspension barrier and skips it on replay', async () => {
    const runtime = node({
      namespace: 'tenant-a',
      autoStartMaintenance: false,
    })
    const crux = config({ runtime })
    const embedded: unknown[] = []
    const embedDocument = durableTask('embed-document', {
      run: async (input: { documentId: string }) => {
        embedded.push(input)
      },
    })
    const reviewFlow = flow('review', async (scope, input: { documentId: string }) => {
      const child = await scope.defer(embedDocument, { documentId: input.documentId })
      await scope.suspend('approval')
      return child.workId
    })
    const runtimeRef = {}
    const resolvedRuntime = createRuntime({
      runtime,
      targets: runtimeTargetMap(runtimeRef),
      startMaintenance: false,
    })
    Object.assign(runtimeRef, { current: resolvedRuntime })

    const suspended = await reviewFlow.run({ documentId: 'doc_1' })
    await resolvedRuntime.dispatcher.nudge()

    expect(embedded).toEqual([{ documentId: 'doc_1' }])
    const snapshot = await runtime.store.state.getSnapshot(
      suspended.flowId as FlowId,
      { namespace: 'tenant-a' },
    )
    const deferredWorkId = snapshot?.scheduledWork?.['defer:1']?.workId
    expect(deferredWorkId).toEqual(expect.any(String))
    expect(snapshot?.continuation).toEqual(
      expect.objectContaining({
        traceparent: expect.any(String),
        crux: expect.objectContaining({ previousSegmentId: expect.any(String) }),
      }),
    )
    expect(() => JSON.stringify(snapshot?.continuation)).not.toThrow()

    await reviewFlow.signal(suspended.flowId, 'approval', {})

    expect(embedded).toEqual([{ documentId: 'doc_1' }])
    await expect(
      runtime.store.state.getSnapshot(suspended.flowId as FlowId, {
        namespace: 'tenant-a',
      }),
    ).resolves.toMatchObject({
      status: 'completed',
      scheduledWork: {
        'defer:1': { workId: deferredWorkId },
      },
    })

    resolvedRuntime.dispose()
    crux.dispose()
  })

  it('flushes flow.after at a suspension barrier and skips timer scheduling on replay', async () => {
    const runtime = node({
      namespace: 'tenant-a',
      autoStartMaintenance: false,
    })
    const crux = config({ runtime })
    const reminders: unknown[] = []
    const sendReminder = durableTask('send-reminder', {
      run: async (input: { userId: string }) => {
        reminders.push(input)
      },
    })
    const reviewFlow = flow('review', async (scope) => {
      await scope.after(sendReminder, '1s', { userId: 'user_1' })
      await scope.suspend('approval')
      return 'done'
    })
    const runtimeRef = {}
    const resolvedRuntime = createRuntime({
      runtime,
      targets: runtimeTargetMap(runtimeRef),
      startMaintenance: false,
    })
    Object.assign(runtimeRef, { current: resolvedRuntime })

    const suspended = await reviewFlow.run()
    const snapshot = await runtime.store.state.getSnapshot(
      suspended.flowId as FlowId,
      { namespace: 'tenant-a' },
    )
    expect(snapshot?.scheduledWork?.['after:1']?.timerId).toEqual(expect.any(String))

    await resolvedRuntime.maintenance.tick({
      now: new Date(Date.now() + 1_100),
    })
    await resolvedRuntime.dispatcher.nudge()
    expect(reminders).toEqual([{ userId: 'user_1' }])

    await reviewFlow.signal(suspended.flowId, 'approval', {})
    await resolvedRuntime.maintenance.tick({
      now: new Date(Date.now() + 2_200),
    })
    await resolvedRuntime.dispatcher.nudge()

    expect(reminders).toEqual([{ userId: 'user_1' }])
    resolvedRuntime.dispose()
    crux.dispose()
  })

  it('waits until current-flow deferred children reach idle', async () => {
    const runtime = node({
      namespace: 'tenant-a',
      autoStartMaintenance: false,
    })
    const crux = config({ runtime })
    const embedded: unknown[] = []
    const embedDocument = durableTask('embed-for-idle', {
      run: async (input: { documentId: string }) => {
        embedded.push(input)
      },
    })
    const reviewFlow = flow('review-idle', async (scope) => {
      await scope.defer(embedDocument, { documentId: 'doc_1' })
      await scope.untilIdle({ scope: 'current-flow' })
      return 'idle'
    })
    const runtimeRef = {}
    const resolvedRuntime = createRuntime({
      runtime,
      targets: runtimeTargetMap(runtimeRef),
      startMaintenance: false,
    })
    Object.assign(runtimeRef, { current: resolvedRuntime })

    const suspended = await reviewFlow.run()
    expect(suspended).toMatchObject({
      status: 'suspended',
      suspendedAt: expect.stringContaining('untilIdle:flow:'),
    })

    await resolvedRuntime.dispatcher.nudge()
    await resolvedRuntime.dispatcher.nudge()

    expect(embedded).toEqual([{ documentId: 'doc_1' }])
    await expect(
      runtime.store.state.getSnapshot(suspended.flowId as FlowId, {
        namespace: 'tenant-a',
      }),
    ).resolves.toMatchObject({ status: 'completed' })

    resolvedRuntime.dispose()
    crux.dispose()
  })

  it('waits for a durable event and resumes with the typed event payload', async () => {
    const runtime = node({
      namespace: 'tenant-a',
      autoStartMaintenance: false,
    })
    const crux = config({ runtime })
    const steps: string[] = []

    const reviewFlow = flow('review', async (scope, input: { documentId: string }) => {
      await scope.step('draft', () => {
        steps.push('draft')
        return 'drafted'
      })
      const approval = await scope.waitFor<{ documentId: string; approvedBy: string }>(
        'document.approved',
        {
          match: { documentId: input.documentId },
          timeout: '1h',
        },
      )
      return await scope.step('publish', () => {
        steps.push('publish')
        return approval.approvedBy
      })
    })
    const runtimeRef = {}
    const resolvedRuntime = createRuntime({
      runtime,
      targets: runtimeTargetMap(runtimeRef),
      startMaintenance: false,
    })
    Object.assign(runtimeRef, { current: resolvedRuntime })

    const suspended = await reviewFlow.run({ documentId: 'doc_1' })

    expect(suspended).toMatchObject({
      status: 'suspended',
      suspendedAt: 'waitFor:document.approved',
    })
    expect(steps).toEqual(['draft'])

    await resolvedRuntime.kernel.emitEvent({
      namespace: 'tenant-a',
      name: 'document.approved',
      payload: { documentId: 'doc_1', approvedBy: 'henri' },
    })
    await resolvedRuntime.dispatcher.nudge()

    expect(steps).toEqual(['draft', 'publish'])
    const snapshot = await runtime.store.state.getSnapshot(
      suspended.flowId as FlowId,
      { namespace: 'tenant-a' },
    )
    expect(snapshot).toMatchObject({
      status: 'completed',
      fingerprint: ['step:draft', 'waitFor:document.approved', 'step:publish'],
    })

    resolvedRuntime.dispose()
    crux.dispose()
  })

  it('signals, resumes, and cancels runtime flows through the configured crux instance', async () => {
    const runtime = node({
      namespace: 'tenant-a',
      autoStartMaintenance: false,
    })
    const crux = config({ runtime })
    const steps: string[] = []

    const reviewFlow = flow('review', async (scope) => {
      await scope.step('draft', () => {
        steps.push('draft')
        return 'drafted'
      })
      await scope.suspend('approval')
      return await scope.step('publish', () => {
        steps.push('publish')
        return 'published'
      })
    })
    const manualFlow = flow('manual-review', async (scope) => {
      await scope.suspend('approval')
      return 'done'
    })

    const suspended = await reviewFlow.run()
    await crux.flows.signal('review', suspended.flowId, 'approval', {})
    expect(steps).toEqual(['draft', 'publish'])

    const manual = await manualFlow.run()
    await manualFlow.signal(manual.flowId, 'approval', {}, { resume: false })
    await expect(crux.flows.resume('manual-review', manual.flowId)).resolves.toMatchObject({
      status: 'completed',
      flowId: manual.flowId,
    })

    const cancellable = await reviewFlow.run({ flowId: 'flow_cancel_via_crux' })
    await expect(crux.flows.cancel('review', cancellable.flowId)).resolves.toEqual({
      cancelled: true,
    })
    await expect(
      runtime.store.state.getSnapshot(cancellable.flowId as FlowId, {
        namespace: 'tenant-a',
      }),
    ).resolves.toMatchObject({ status: 'cancelled' })

    crux.dispose()
  })

  it('cancels runtime work and its flow snapshot through the flow handle', async () => {
    const runtime = node({
      namespace: 'tenant-a',
      autoStartMaintenance: false,
    })
    const crux = config({ runtime })
    const reviewFlow = flow('handle-cancel-review', async (scope) => {
      await scope.suspend('approval')
      return 'done'
    })

    const suspended = await reviewFlow.run({ flowId: 'flow_cancel_via_handle' })
    const before = await runtime.store.state.getSnapshot(suspended.flowId as FlowId, {
      namespace: 'tenant-a',
    })

    await expect(reviewFlow.cancel(suspended.flowId)).resolves.toBeUndefined()
    await expect(
      runtime.store.state.getWork(before!.workId as WorkId, {
        namespace: 'tenant-a',
      }),
    ).resolves.toMatchObject({ status: 'cancelled' })
    await expect(
      runtime.store.state.getSnapshot(suspended.flowId as FlowId, {
        namespace: 'tenant-a',
      }),
    ).resolves.toMatchObject({ status: 'cancelled' })

    crux.dispose()
  })

  it('keeps handle cancellation idempotent for an unknown runtime flow id', async () => {
    const crux = config({
      runtime: node({ namespace: 'tenant-a', autoStartMaintenance: false }),
    })
    const reviewFlow = flow('missing-handle-cancel', async () => 'done')

    await expect(reviewFlow.cancel('missing_flow')).resolves.toBeUndefined()
    await expect(
      crux.flows.cancel('missing-handle-cancel', 'missing_flow'),
    ).rejects.toMatchObject({ code: 'TARGET_NOT_FOUND' })

    crux.dispose()
  })

  it('validates name-bound signal flow id and target name before emitting', async () => {
    const runtime = node({
      namespace: 'tenant-a',
      autoStartMaintenance: false,
    })
    const crux = config({ runtime })
    const reviewFlow = flow('signal-validation-review', async (scope) => {
      await scope.suspend('approval')
      return 'done'
    })

    const suspended = await reviewFlow.run()

    await expect(
      crux.flows.signal('signal-validation-review', 'missing_flow', 'approval', {}),
    ).rejects.toMatchObject({
      code: 'TARGET_NOT_FOUND',
      message: expect.stringContaining(
        'crux.flows.signal() could not find runtime-backed flow `missing_flow`.',
      ),
    })
    await expect(
      crux.flows.signal('other-signal-target', suspended.flowId, 'approval', {}),
    ).rejects.toMatchObject({
      code: 'TARGET_NOT_FOUND',
      message: expect.stringContaining(
        `crux.flows.signal() could not operate on flow \`${suspended.flowId}\` through target \`other-signal-target\`.`,
      ),
    })

    crux.dispose()
  })

  it('throws the standard runtime-required diagnostic for runtime-only flow APIs', async () => {
    const crux = config({})
    const embedDocument = durableTask('missing-runtime-embed', {
      run: async (_input: { documentId: string }) => undefined,
    })
    const reviewFlow = flow('review', async (scope) => {
      await scope.waitFor('document.approved')
      return 'done'
    })

    await expect(reviewFlow.run()).rejects.toMatchObject({
      code: 'RUNTIME_REQUIRED',
      message: expect.stringContaining('flow.waitFor() requires a Crux runtime engine.'),
    })
    await expect(crux.flows.signal('review', 'flow_1', 'approval', {})).rejects.toMatchObject({
      code: 'RUNTIME_REQUIRED',
      message: expect.stringContaining('crux.flows.signal() requires a Crux runtime engine.'),
    })
    await expect(
      flow('defer-without-runtime', async (scope) => {
        await scope.defer(embedDocument, { documentId: 'doc_1' })
      }).run(),
    ).rejects.toMatchObject({
      code: 'RUNTIME_REQUIRED',
      message: expect.stringContaining('flow.defer() requires a Crux runtime engine.'),
    })
    await expect(
      flow('after-without-runtime', async (scope) => {
        await scope.after(embedDocument, '1h', { documentId: 'doc_1' })
      }).run(),
    ).rejects.toMatchObject({
      code: 'RUNTIME_REQUIRED',
      message: expect.stringContaining('flow.after() requires a Crux runtime engine.'),
    })
    await expect(
      flow('idle-without-runtime', async (scope) => {
        await scope.untilIdle({ scope: 'current-flow' })
      }).run(),
    ).rejects.toMatchObject({
      code: 'RUNTIME_REQUIRED',
      message: expect.stringContaining('flow.untilIdle() requires a Crux runtime engine.'),
    })

    crux.dispose()
  })

  it('suspends into runtime state and auto-resumes when the flow handle signals', async () => {
    const runtime = node({
      namespace: 'tenant-a',
      autoStartMaintenance: false,
    })
    const crux = config({ runtime })
    const steps: string[] = []

    const reviewFlow = flow('review', async (scope, input: { documentId: string }) => {
      const draft = await scope.step('draft', () => {
        steps.push('draft')
        return { documentId: input.documentId, version: 1 }
      })
      const approval = await scope.suspend<{ approvedBy: string }>('approval')
      return await scope.step('publish', () => {
        steps.push('publish')
        return { ...draft, approval }
      })
    })

    const suspended = await reviewFlow.run({ documentId: 'doc_1' })

    expect(suspended).toMatchObject({
      status: 'suspended',
      suspendedAt: 'approval',
    })
    expect(steps).toEqual(['draft'])
    const snapshot = await runtime.store.state.getSnapshot(
      suspended.flowId as FlowId,
      { namespace: 'tenant-a' },
    )
    expect(snapshot).toMatchObject({
      flowId: suspended.flowId,
      targetId: 'review' as RuntimeTargetId,
      status: 'suspended',
      input: { documentId: 'doc_1' },
      completedSteps: {
        draft: { documentId: 'doc_1', version: 1 },
      },
      fingerprint: ['step:draft', 'suspend:approval'],
    })

    await reviewFlow.signal(suspended.flowId, 'approval', {
      approvedBy: 'henri',
    })

    expect(steps).toEqual(['draft', 'publish'])
    await expect(
      runtime.store.state.getWork(snapshot!.workId as WorkId, {
        namespace: 'tenant-a',
      }),
    ).resolves.toMatchObject({ status: 'completed' })

    crux.dispose()
  })

  it('does not execute a completed flow again when a later signal is delivered', async () => {
    const runtime = node({
      namespace: 'tenant-a',
      autoStartMaintenance: false,
    })
    const crux = config({ runtime })
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const steps: string[] = []

    const reviewFlow = flow('review', async (scope) => {
      await scope.step('draft', () => {
        steps.push('draft')
        return 'drafted'
      })
      await scope.suspend('approval')
      return await scope.step('publish', () => {
        steps.push('publish')
        return 'published'
      })
    })

    const suspended = await reviewFlow.run()
    await reviewFlow.signal(suspended.flowId, 'approval', {})
    await reviewFlow.signal(suspended.flowId, 'approval', {})

    expect(steps).toEqual(['draft', 'publish'])
    await observe.flush()

    const lifecycle = transport.records.filter((record) => record.type.startsWith('run:'))
    expect(lifecycle.map((record) => record.type)).toEqual([
      'run:start',
      'run:suspend',
      'run:resume',
      'run:end',
    ])
    expect(lifecycle.filter((record) => record.type === 'run:end')).toHaveLength(1)

    crux.dispose()
  })

  it('can store a runtime signal and resume later through the flow handle', async () => {
    const runtime = node({
      namespace: 'tenant-a',
      autoStartMaintenance: false,
    })
    const crux = config({ runtime })
    const steps: string[] = []

    const reviewFlow = flow('review', async (scope) => {
      await scope.step('draft', () => {
        steps.push('draft')
        return 'drafted'
      })
      await scope.suspend('approval')
      return await scope.step('publish', () => {
        steps.push('publish')
        return 'published'
      })
    })

    const suspended = await reviewFlow.run()
    await reviewFlow.signal(suspended.flowId, 'approval', {}, { resume: false })

    expect(steps).toEqual(['draft'])

    const resumed = await reviewFlow.resume(suspended.flowId)

    expect(resumed).toMatchObject({ status: 'completed', flowId: suspended.flowId })
    expect(steps).toEqual(['draft', 'publish'])

    crux.dispose()
  })

  it('propagates runtime flow handler errors to the object-bound run caller', async () => {
    const runtime = node({
      namespace: 'tenant-a',
      autoStartMaintenance: false,
    })
    const crux = config({ runtime })
    const brokenFlow = flow('broken-inline-runtime-flow', async () => {
      throw new Error('handler exploded')
    })

    await expect(brokenFlow.run()).rejects.toThrow('handler exploded')

    const [work] = await runtime.store.state.listWork({
      namespace: 'tenant-a',
      status: 'pending',
      limit: 1,
    })
    expect(work).toMatchObject({
      targetId: 'broken-inline-runtime-flow' as RuntimeTargetId,
      status: 'pending',
      attempt: 2,
    })

    crux.dispose()
  })

  it('commits scope.cancel() through the runtime kernel', async () => {
    const runtime = node({
      namespace: 'tenant-a',
      autoStartMaintenance: false,
    })
    const crux = config({ runtime })
    const cancelledFlow = flow('cancel-from-handler', async (scope) => {
      scope.cancel('not needed')
    })

    const result = await cancelledFlow.run({ flowId: 'flow_cancel_from_handler' })

    expect(result).toEqual({
      status: 'cancelled',
      flowId: 'flow_cancel_from_handler',
      cancelReason: 'not needed',
    })
    const snapshot = await runtime.store.state.getSnapshot('flow_cancel_from_handler' as FlowId, {
      namespace: 'tenant-a',
    })
    expect(snapshot).toMatchObject({
      status: 'cancelled',
      flowId: 'flow_cancel_from_handler',
      targetId: 'cancel-from-handler' as RuntimeTargetId,
    })
    await expect(
      runtime.store.state.getWork(snapshot!.workId as WorkId, {
        namespace: 'tenant-a',
      }),
    ).resolves.toMatchObject({ status: 'cancelled' })

    crux.dispose()
  })

  it('passes resume options into runtime-backed flow replay', async () => {
    const runtime = node({
      namespace: 'tenant-a',
      autoStartMaintenance: false,
    })
    const crux = config({ runtime })
    const parentFlowIds: Array<string | undefined> = []
    const reviewFlow = flow('runtime-resume-options', async (scope) => {
      await scope.suspend('approval')
      parentFlowIds.push(getExecutionContext()?.parentFlowId)
      return 'approved'
    })

    const suspended = await reviewFlow.run()
    await reviewFlow.signal(suspended.flowId, 'approval', {}, { resume: false })
    await expect(
      reviewFlow.resume(suspended.flowId, {
        parentFlowId: 'flow_parent_1',
        goal: 'Resume after approval',
      }),
    ).resolves.toMatchObject({ status: 'completed', output: 'approved' })

    expect(parentFlowIds).toEqual(['flow_parent_1'])

    crux.dispose()
  })

  it('replays repeated same-label runtime suspend payloads by source occurrence', async () => {
    const runtime = node({
      namespace: 'tenant-a',
      autoStartMaintenance: false,
    })
    const crux = config({ runtime })
    const reviewFlow = flow('runtime-repeated-signal-labels', async (scope) => {
      const first = await scope.suspend<{ value: string }>('approval')
      const second = await scope.suspend<{ value: string }>('approval')
      return [first.value, second.value]
    })

    const firstSuspend = await reviewFlow.run()
    await reviewFlow.signal(firstSuspend.flowId, 'approval', { value: 'first' }, { resume: false })
    await expect(reviewFlow.resume(firstSuspend.flowId)).resolves.toMatchObject({
      status: 'suspended',
      suspendedAt: 'approval',
    })

    await reviewFlow.signal(firstSuspend.flowId, 'approval', { value: 'second' }, { resume: false })
    await expect(reviewFlow.resume(firstSuspend.flowId)).resolves.toMatchObject({
      status: 'completed',
      output: ['first', 'second'],
    })

    crux.dispose()
  })

  it('replays a delivered runtime null payload instead of suspending again', async () => {
    const runtime = node({
      namespace: 'tenant-a',
      autoStartMaintenance: false,
    })
    const crux = config({ runtime })
    const reviewFlow = flow('runtime-null-signal-payload', async (scope) => {
      return await scope.suspend<null>('approval')
    })

    const suspended = await reviewFlow.run()
    await reviewFlow.signal(suspended.flowId, 'approval', null, { resume: false })
    await expect(reviewFlow.resume(suspended.flowId)).resolves.toMatchObject({
      status: 'completed',
      output: null,
    })

    await expect(
      runtime.store.state.getSnapshot(suspended.flowId as FlowId, {
        namespace: 'tenant-a',
      }),
    ).resolves.toMatchObject({
      status: 'completed',
    })

    crux.dispose()
  })

  it('blocks runtime work when replay fingerprint diverges before a cached step', async () => {
    const runtime = node({
      namespace: 'tenant-a',
      autoStartMaintenance: false,
    })
    const crux = config({ runtime })
    const original = flow('review', async (scope) => {
      await scope.step('draft', () => 'drafted')
      await scope.suspend('approval')
      return 'done'
    })
    const suspended = await original.run()
    const snapshot = await runtime.store.state.getSnapshot(
      suspended.flowId as FlowId,
      { namespace: 'tenant-a' },
    )
    const renamedStepExecutions: string[] = []
    const changed = flow('review', async (scope) => {
      await scope.step('renamed-draft', () => {
        renamedStepExecutions.push('renamed-draft')
        return 'drafted'
      })
      await scope.suspend('approval')
      return 'done'
    })

    await changed.signal(suspended.flowId, 'approval', {})

    expect(renamedStepExecutions).toEqual([])
    await expect(
      runtime.store.state.getWork(snapshot!.workId as WorkId, {
        namespace: 'tenant-a',
      }),
    ).resolves.toMatchObject({
      status: 'blocked',
      lastError: {
        code: 'REPLAY_DIVERGED',
        message: expect.stringContaining('expected `step:draft`'),
      },
    })

    crux.dispose()
  })
})
