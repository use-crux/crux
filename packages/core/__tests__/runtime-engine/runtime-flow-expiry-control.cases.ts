import { afterEach, describe, expect, it } from 'vitest'
import { config, flow } from '@use-crux/core'
import { node, type FlowId, type WorkId } from '@use-crux/core/runtime'
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from '@use-crux/core/observability'
import { inMemoryRecordStore } from '../../src/storage'

afterEach(() => {
  resetObservabilityRuntime()
})

describe('name-bound Runtime flow expiry', () => {
  it('returns the current observed expiry for a due suspended flow', async () => {
    const runtime = node({
      namespace: 'runtime-name-bound-expiry',
      autoStartMaintenance: false,
    })
    const crux = config({ runtime })
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    let expiredCalls = 0
    const review = flow('runtime name-bound expiry', async (scope) => {
      await scope.suspend('approval', {
        timeout: '0ms',
        onExpired: () => {
          expiredCalls += 1
        },
      })
      return 'published'
    })

    try {
      const suspended = await review.run({
        flowId: 'runtime-name-bound-expiry-flow',
      })
      const expired = await crux.flows.resume(review.name, suspended.flowId)
      await observe.flush()
      const snapshot = await runtime.store.state.getSnapshot(
        suspended.flowId as FlowId,
        { namespace: runtime.namespace },
      )
      const work = await runtime.store.state.getWork(
        snapshot?.workId as WorkId,
        { namespace: runtime.namespace },
      )
      const owners = transport.records.filter(
        (record) =>
          record.type === 'span:start' &&
          record.primitive === 'flow.run' &&
          record.attributes.flowId === suspended.flowId,
      )

      expect(expired).toMatchObject({
        status: 'expired',
        _meta: {
          traceId: owners[1]?.traceId,
          spanId: owners[1]?.spanId,
        },
      })
      expect(expiredCalls).toBe(1)
      expect(snapshot?.status).toBe('expired')
      expect(work?.status).toBe('completed')
      await expect(
        crux.flows.resume(review.name, suspended.flowId),
      ).rejects.toThrow('durable flow snapshot is expired')
    } finally {
      crux.dispose()
    }
  })

  it('lets a delivered signal win on name-bound resume', async () => {
    const runtime = node({
      namespace: 'runtime-name-bound-signal-wins',
      autoStartMaintenance: false,
    })
    const crux = config({ runtime })
    let expiredCalls = 0
    const review = flow('runtime name-bound signal wins', async (scope) => {
      return await scope.suspend<{ approved: boolean }>('approval', {
        timeout: '0ms',
        onExpired: () => {
          expiredCalls += 1
        },
      })
    })

    try {
      const suspended = await review.run({
        flowId: 'runtime-name-bound-signal-wins-flow',
      })
      await review.signal(
        suspended.flowId,
        'approval',
        { approved: true },
        { resume: false },
      )
      const resumed = await crux.flows.resume(review.name, suspended.flowId)

      expect(resumed).toMatchObject({
        status: 'completed',
        output: { approved: true },
      })
      expect(expiredCalls).toBe(0)
    } finally {
      crux.dispose()
    }
  })

  it('does not write Runtime expiry into the record-store snapshot namespace', async () => {
    const runtime = node({
      namespace: 'runtime-dual-store-expiry',
      autoStartMaintenance: false,
    })
    const records = inMemoryRecordStore()
    const crux = config({ runtime, persistence: { records } })
    const review = flow('runtime dual-store expiry', async (scope) => {
      await scope.suspend('approval', { timeout: '0ms' })
      return 'published'
    })

    try {
      const suspended = await review.run({
        flowId: 'runtime-dual-store-expiry-flow',
      })
      await review.resume(suspended.flowId)

      await expect(
        records.get(`crux:flow:${suspended.flowId}`),
      ).resolves.toBeNull()
    } finally {
      crux.dispose()
    }
  })
})
