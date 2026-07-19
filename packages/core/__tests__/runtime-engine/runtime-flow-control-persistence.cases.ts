import { describe, expect, it } from 'vitest'
import { config, flow } from '@use-crux/core'
import { node, type FlowId } from '@use-crux/core/runtime'

describe('name-bound Runtime flow persistence', () => {
  it('sanitizes crux.flows.signal payloads before event persistence', async () => {
    const runtime = node({
      namespace: 'runtime-sanitized-name-bound-signal',
      autoStartMaintenance: false,
    })
    const crux = config({ runtime })
    const review = flow('runtime sanitized name-bound signal', async (scope) => {
      return await scope.suspend('approval')
    })
    const livePayload = {
      nested: {
        _meta: {
          traceId: 'signal-trace',
          spanId: 'signal-span',
          cacheStatus: 'hit',
        },
      },
    }

    try {
      const suspended = await review.run({
        flowId: 'runtime-sanitized-name-bound-signal-flow',
      })
      await crux.flows.signal(
        review.name,
        suspended.flowId,
        'approval',
        livePayload,
      )
      const eventLog = await runtime.store.events.read({
        namespace: runtime.namespace,
      })
      const event = eventLog.events.find((candidate) =>
        candidate.name.endsWith(':approval'),
      )
      const snapshot = await runtime.store.state.getSnapshot(
        suspended.flowId as FlowId,
        { namespace: runtime.namespace },
      )
      const expectedPayload = {
        nested: { _meta: { cacheStatus: 'hit' } },
      }

      expect(event?.payload).toEqual(expectedPayload)
      expect(Object.values(snapshot?.deliveredSuspends ?? {})[0]?.payload).toEqual(
        expectedPayload,
      )
      expect(livePayload.nested._meta).toMatchObject({
        traceId: 'signal-trace',
        spanId: 'signal-span',
      })
    } finally {
      crux.dispose()
    }
  })
})
