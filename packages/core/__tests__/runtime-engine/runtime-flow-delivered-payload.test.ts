import { afterEach, describe, expect, it } from 'vitest'
import { config, flow } from '@use-crux/core'
import {
  createRuntime,
  inMemoryRuntimeStore,
  node,
  type FlowId,
  type WorkId,
} from '@use-crux/core/runtime'
import { runtimeTargetMap } from '../../src/runtime/api/target-registry'
import { resetHooks } from '../../src/runtime/runtime'

afterEach(() => {
  resetHooks()
})

describe('runtime-backed flow delivered payload replay', () => {
  it('resumes delivered runtime payloads without reading the event log', async () => {
    const store = inMemoryRuntimeStore()
    let eventReadCalls = 0
    const runtime = node({
      namespace: 'tenant-a',
      autoStartMaintenance: false,
      store: {
        ...store,
        events: {
          ...store.events,
          read: async (options: Parameters<typeof store.events.read>[0]) => {
            eventReadCalls += 1
            return await store.events.read(options)
          },
        },
      },
    })
    const crux = config({ runtime })
    const approvals: string[] = []
    const reviewFlow = flow('runtime-zero-event-log-replay', async (scope) => {
      const approval = await scope.waitFor<{ value: string }>(
        'document.approved',
      )
      approvals.push(approval.value)
      return approval.value
    })
    const runtimeRef = {}
    const resolvedRuntime = createRuntime({
      runtime,
      targets: runtimeTargetMap(runtimeRef),
      startMaintenance: false,
    })
    Object.assign(runtimeRef, { current: resolvedRuntime })

    const suspended = await reviewFlow.run()
    await resolvedRuntime.kernel.emitEvent({
      namespace: 'tenant-a',
      name: 'document.approved',
      payload: { value: 'embedded' },
    })
    await resolvedRuntime.dispatcher.nudge()

    expect(approvals).toEqual(['embedded'])
    expect(eventReadCalls).toBe(0)
    await expect(
      runtime.store.state.getSnapshot(suspended.flowId as FlowId, {
        namespace: 'tenant-a',
      }),
    ).resolves.toMatchObject({ status: 'completed' })

    resolvedRuntime.dispose()
    crux.dispose()
  })

  it('blocks legacy delivered snapshots without payloads with a replay diagnostic', async () => {
    const runtime = node({
      namespace: 'tenant-a',
      autoStartMaintenance: false,
    })
    const crux = config({ runtime })
    const reviewFlow = flow('runtime-legacy-delivery', async (scope) => {
      return await scope.suspend<{ approved: boolean }>('approval')
    })

    const suspended = await reviewFlow.run()
    await reviewFlow.signal(
      suspended.flowId,
      'approval',
      { approved: true },
      { resume: false },
    )
    const snapshot = await runtime.store.state.getSnapshot(
      suspended.flowId as FlowId,
      { namespace: 'tenant-a' },
    )
    expect(snapshot).not.toBeNull()
    await runtime.store.state.putSnapshot({
      ...snapshot!,
      pendingSuspends: snapshot!.pendingSuspends.map((suspend) => ({
        ...suspend,
        delivered: suspend.delivered
          ? ({
              eventId: suspend.delivered.eventId,
            } as unknown as typeof suspend.delivered)
          : undefined,
      })),
      deliveredSuspends: Object.fromEntries(
        Object.entries(snapshot!.deliveredSuspends ?? {}).map(
          ([deliveryKey, delivery]) => [
            deliveryKey,
            delivery
              ? ({
                  eventId: delivery.eventId,
                } as unknown as typeof delivery)
              : undefined,
          ],
        ),
      ) as typeof snapshot.deliveredSuspends,
    })

    await expect(reviewFlow.resume(suspended.flowId)).rejects.toThrow(
      'did not produce an inline result',
    )
    await expect(
      runtime.store.state.getWork(snapshot!.workId as WorkId, {
        namespace: 'tenant-a',
      }),
    ).resolves.toMatchObject({
      status: 'blocked',
      lastError: {
        code: 'REPLAY_DIVERGED',
        message: expect.stringContaining(
          'snapshot predates runtime payload embedding',
        ),
      },
    })

    crux.dispose()
  })
})
