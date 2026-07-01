import { afterEach, describe, expect, it } from 'vitest'
import { flow, InvalidSignalPayloadError, noPayload, signalFlow, type FlowSnapshot } from '../../flow'
import { resetRuntime, updateRuntime } from '../../runtime/runtime'
import { inMemoryRecordStore, type JsonValue } from '../../storage'

describe('flow signal consumption', () => {
  afterEach(() => {
    resetRuntime()
  })

  it('consumes a delivered signal before user code continues past suspend', async () => {
    const store = inMemoryRecordStore()
    updateRuntime({ records: store })

    const review = flow('consume delivered signal', async (scope) => {
      await scope.suspend('approval')
      await scope.suspend('approval')
      return 'published'
    })

    const suspended = await review.run({ flowId: 'flow-signal-consumption' })
    expect(suspended).toMatchObject({
      status: 'suspended',
      flowId: 'flow-signal-consumption',
      suspendedAt: 'approval',
    })

    await review.signal(suspended.flowId, 'approval')

    const awaitingSecondApproval = await review.resume(suspended.flowId)
    expect(awaitingSecondApproval).toMatchObject({
      status: 'suspended',
      flowId: suspended.flowId,
      suspendedAt: 'approval',
    })
    await expect(store.get(`crux:signal:${suspended.flowId}:approval`)).resolves.toBeNull()

    await review.signal(suspended.flowId, 'approval')

    const completed = await review.resume(suspended.flowId)
    expect(completed).toMatchObject({
      status: 'completed',
      flowId: suspended.flowId,
      output: 'published',
    })
  })

  it('rejects payloads for noPayload signals before and during delivery', async () => {
    const store = inMemoryRecordStore()
    updateRuntime({ records: store })
    const release = flow(
      'no payload validation',
      { signals: { release: noPayload() } },
      async (scope) => {
        await scope.suspend('release')
        return 'released'
      },
    )
    const sendRelease = release.signal as unknown as (
      flowId: string,
      signalName: string,
      payload?: JsonValue,
    ) => Promise<void>

    const suspended = await release.run({ flowId: 'flow-no-payload-validation' })
    expect(suspended.status).toBe('suspended')

    await expect(sendRelease(suspended.flowId, 'release', { unexpected: true })).rejects.toBeInstanceOf(
      InvalidSignalPayloadError,
    )
    await expect(store.get(`crux:signal:${suspended.flowId}:release`)).resolves.toBeNull()

    await signalFlow(suspended.flowId, 'release', { unexpected: true })
    await expect(release.resume(suspended.flowId)).rejects.toBeInstanceOf(InvalidSignalPayloadError)

    await signalFlow(suspended.flowId, 'release', {})
    await expect(release.resume(suspended.flowId)).resolves.toMatchObject({
      status: 'completed',
      output: 'released',
    })
  })

  it('preserves explicit null signal payloads', async () => {
    const store = inMemoryRecordStore()
    updateRuntime({ records: store })
    const passthrough = flow('null payload signal', async (scope) => {
      return scope.suspend('done')
    })

    const suspended = await passthrough.run({ flowId: 'flow-null-signal' })
    expect(suspended.status).toBe('suspended')

    await signalFlow(suspended.flowId, 'done', null)
    await expect(passthrough.resume(suspended.flowId)).resolves.toMatchObject({
      status: 'completed',
      output: null,
    })
  })

  it('persists resume-attempt progress when a flow expires', async () => {
    const store = inMemoryRecordStore()
    updateRuntime({ records: store })
    const flowId = 'flow-expired-keeps-progress'
    const now = Date.now()
    const expiredTimeout = now - 1
    const expiring = flow('expired attempt progress', async (scope) => {
      const approval = (await scope.suspend('gate-1')) as { approved: boolean }
      await scope.step('after approval', () => ({ approved: approval.approved }))
      await scope.suspend('gate-2', { timeout: '0ms' })
    })

    await store.put(`crux:flow:${flowId}`, {
      flowId,
      name: 'expired attempt progress',
      status: 'suspended',
      suspendedAt: 'gate-2',
      completedSteps: {},
      deliveredSignals: {
        '1:gate-1': {
          signalName: 'gate-1',
          payload: { approved: true },
          deliveredAt: now - 10,
        },
      },
      traceContext: {},
      createdAt: now - 20,
      updatedAt: now - 10,
      timeoutAt: expiredTimeout,
    } satisfies FlowSnapshot)

    await expect(expiring.resume(flowId)).resolves.toMatchObject({
      status: 'expired',
      flowId,
    })
    await expect(store.get(`crux:flow:${flowId}`)).resolves.toMatchObject({
      status: 'expired',
      completedSteps: {
        'after approval': {
          output: { approved: true },
          durationMs: expect.any(Number),
        },
      },
      deliveredSignals: {
        '1:gate-1': {
          signalName: 'gate-1',
          payload: { approved: true },
          deliveredAt: expect.any(Number),
        },
      },
    })
  })
})
