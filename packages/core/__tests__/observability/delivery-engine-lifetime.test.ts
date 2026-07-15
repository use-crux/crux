import { expect, it, vi } from 'vitest'
import type { CruxGraphRecord } from '../../src/observability'
import { createDeliveryEngine } from '../../src/observability/delivery/engine'

it('keeps its lifetime anchor through queued, pending, and reset states', () => {
  vi.useFakeTimers()
  try {
    const engine = createDeliveryEngine()
    const listener = () => undefined
    engine.anchorLifetime(listener)
    engine.setTransport({ send: () => new Promise(() => undefined) })
    engine.configureDelivery({ scheduledDelayMs: 1_000 })

    engine.enqueue(deliveryRecord('rec_anchor_queued'))
    expect(engine.lifetimeAnchor()).toBe(listener)

    vi.advanceTimersByTime(1_000)
    expect(engine.diagnostics().pendingDeliveries).toBe(1)
    expect(engine.lifetimeAnchor()).toBe(listener)

    engine.reset()
    expect(engine.lifetimeAnchor()).toBe(listener)
  } finally {
    vi.useRealTimers()
  }
})

function deliveryRecord(recordId: string): CruxGraphRecord {
  return {
    schemaVersion: 2,
    recordId,
    type: 'run:start',
    runId: 'run_delivery_anchor',
    segmentId: 'seg_delivery_anchor',
    segmentSeq: 1,
    traceId: '11111111111111111111111111111111',
    name: 'delivery anchor',
    rootPrimitive: 'custom.operation',
    startedAt: '2026-07-15T00:00:00.000Z',
    status: 'running',
  } as CruxGraphRecord
}
