import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  acceptedDeliveryReceipt,
  observe,
  observabilityDiagnostics,
  resetObservabilityRuntime,
  setObservabilityTransport,
  type CruxDeliveryReceipt,
  type CruxGraphRecord,
  type CruxObservabilityTransport,
} from '../../src/observability'
import { chaosTransport } from './helpers/chaos-transport'

describe('observability delivery reconfiguration accounting', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    resetObservabilityRuntime()
  })

  it('does not label a stale transport genuinely accepting old-epoch records as dropped', async () => {
    const first = chaosTransport('slow')
    setObservabilityTransport(first.transport, { scheduledDelayMs: 0, maxPendingDeliveries: 1 })

    observe.openRun({ name: 'reconfig run accepted', rootPrimitive: 'custom.operation' })

    expect(observabilityDiagnostics()).toMatchObject({ pendingDeliveries: 1, reconfiguredDroppedRecords: 0 })

    const delivered: CruxGraphRecord[] = []
    setObservabilityTransport({
      send(records) {
        delivered.push(...records)
        return acceptedDeliveryReceipt(records)
      },
    })

    // Reconfiguration alone must not presume an outcome for the still
    // in-flight old-epoch send; nothing is known until it settles.
    expect(observabilityDiagnostics().reconfiguredDroppedRecords).toBe(0)

    first.resolveSlowDeliveries()
    await Promise.resolve()
    await Promise.resolve()

    // The stale transport genuinely accepted the record, so it is counted as
    // accepted - not silently mislabeled as reconfiguration loss - and the
    // new transport never received it.
    expect(observabilityDiagnostics()).toMatchObject({
      reconfiguredDroppedRecords: 0,
      acceptedRecords: 1,
    })
    expect(delivered).toEqual([])
  })

  it('counts an old-epoch record the stale transport rejects, and one it leaves retryable, explicitly', async () => {
    const resolvers: Array<(receipt: CruxDeliveryReceipt) => void> = []
    const records: CruxGraphRecord[][] = []
    const staleTransport: CruxObservabilityTransport = {
      send: (batch) =>
        new Promise((resolve) => {
          records.push([...batch])
          resolvers.push(resolve)
        }),
    }
    setObservabilityTransport(staleTransport, { scheduledDelayMs: 0, maxBatchSize: 1, maxPendingDeliveries: 2 })

    observe.openRun({ name: 'reconfig run rejected', rootPrimitive: 'custom.operation' })
    observe.openRun({ name: 'reconfig run retryable', rootPrimitive: 'custom.operation' })

    expect(resolvers).toHaveLength(2)

    setObservabilityTransport({ send: acceptedDeliveryReceipt })

    resolvers[0]!({
      dispositions: [
        { index: 0, recordId: records[0]![0]!.recordId, outcome: 'rejected', code: 'invalid', retryable: false },
      ],
    })
    resolvers[1]!({
      dispositions: [
        { index: 0, recordId: records[1]![0]!.recordId, outcome: 'rejected', code: 'retry_me', retryable: true },
      ],
    })
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    // A record the stale transport permanently rejects and one it leaves
    // retryable (which is never requeued against a transport it was never
    // sent to, so it is truly lost to reconfiguration) are counted
    // explicitly and separately - never lumped into one ambiguous bucket.
    expect(observabilityDiagnostics()).toMatchObject({
      permanentlyRejectedRecords: 1,
      reconfiguredDroppedRecords: 1,
      acceptedRecords: 0,
    })
  })

  it("does not let a superseded epoch's stuck in-flight delivery block the new transport's own maxPendingDeliveries budget", async () => {
    const stale = chaosTransport('hang')
    setObservabilityTransport(stale.transport, { scheduledDelayMs: 0, maxPendingDeliveries: 1 })

    observe.openRun({ name: 'stuck on stale transport', rootPrimitive: 'custom.operation' })
    expect(observabilityDiagnostics()).toMatchObject({ pendingDeliveries: 1 })

    const delivered: CruxGraphRecord[] = []
    setObservabilityTransport(
      {
        send(records) {
          delivered.push(...records)
          return acceptedDeliveryReceipt(records)
        },
      },
      { scheduledDelayMs: 0, maxPendingDeliveries: 1 },
    )

    // The new epoch's own maxPendingDeliveries budget (1) is untouched by
    // the still-unsettled stale delivery, which is tracked separately.
    observe.openRun({ name: 'new epoch work', rootPrimitive: 'custom.operation' })
    await Promise.resolve()
    await Promise.resolve()

    expect(delivered.length).toBeGreaterThan(0)
    expect(observabilityDiagnostics()).toMatchObject({
      pendingDeliveries: 0,
      reconfiguredRemainingRecords: 1,
    })
  })

  it('accumulates superseded records across multiple reconfigurations and clears them on a full reset', async () => {
    const first = chaosTransport('hang')
    setObservabilityTransport(first.transport, { scheduledDelayMs: 0, maxPendingDeliveries: 1 })
    observe.openRun({ name: 'stuck on first', rootPrimitive: 'custom.operation' })

    const second = chaosTransport('hang')
    setObservabilityTransport(second.transport, { scheduledDelayMs: 0, maxPendingDeliveries: 1 })
    observe.openRun({ name: 'stuck on second', rootPrimitive: 'custom.operation' })

    setObservabilityTransport({ send: acceptedDeliveryReceipt })

    // Two separate reconfigurations, two still-unsettled stale deliveries -
    // both are tracked, not just the most recent one.
    expect(observabilityDiagnostics().reconfiguredRemainingRecords).toBe(2)

    resetObservabilityRuntime()
    expect(observabilityDiagnostics().reconfiguredRemainingRecords).toBe(0)
  })

  it('never lets a delivery that settles after a full reset mutate the fresh runtime it was reset to', async () => {
    const stale = chaosTransport('slow')
    setObservabilityTransport(stale.transport, { scheduledDelayMs: 0, maxPendingDeliveries: 1 })
    observe.openRun({ name: 'settles after reset', rootPrimitive: 'custom.operation' })
    expect(observabilityDiagnostics()).toMatchObject({ pendingDeliveries: 1 })

    // A full reset (not a reconfiguration) tears the runtime down while that
    // send is still in flight against the old, now-abandoned transport.
    resetObservabilityRuntime()

    const delivered: CruxGraphRecord[] = []
    setObservabilityTransport(
      {
        send(records) {
          delivered.push(...records)
          return acceptedDeliveryReceipt(records)
        },
      },
      { scheduledDelayMs: 0 },
    )
    observe.openRun({ name: 'fresh run after reset', rootPrimitive: 'custom.operation' })
    await observe.flush()

    const beforeStaleSettles = observabilityDiagnostics()
    expect(beforeStaleSettles.acceptedRecords).toBe(1)

    // Now let the pre-reset delivery genuinely settle (as accepted).
    stale.resolveSlowDeliveries()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    // The stale callback must be a complete no-op against the fresh runtime:
    // no accepted/rejected/reconfigured/pending counters move because of it.
    expect(observabilityDiagnostics()).toEqual(beforeStaleSettles)
    expect(delivered).toHaveLength(1)
  })

  it('bounds retained superseded promise references across many reconfigured hung transports without hot-spinning the drain', async () => {
    const maxPendingDeliveries = 2
    const reconfigurationCount = 25
    for (let index = 0; index < reconfigurationCount; index += 1) {
      const stale = chaosTransport('hang')
      setObservabilityTransport(stale.transport, { scheduledDelayMs: 0, maxPendingDeliveries })
      observe.openRun({ name: `stuck on transport ${index}`, rootPrimitive: 'custom.operation' })
    }
    // One final reconfiguration moves the last loop iteration's still-current
    // delivery into the superseded bucket too, and gives the drain below a
    // transport capable of ever draining the (empty) current epoch.
    setObservabilityTransport({ send: acceptedDeliveryReceipt })

    // Every reconfiguration left one still-unsettled delivery: the truthful
    // aggregate count reflects all of them...
    const beforeFlush = observabilityDiagnostics()
    expect(beforeFlush.reconfiguredRemainingRecords).toBe(reconfigurationCount)
    // ...but the retained promise references are bounded by the same cap
    // that already bounds one epoch's own concurrent in-flight sends,
    // regardless of how many reconfigurations occurred.
    expect(beforeFlush.reconfiguredTrackedDeliveries).toBeLessThanOrEqual(maxPendingDeliveries)

    const startedAt = Date.now()
    const result = await observe.flush({ timeoutMs: 50 })
    const elapsedMs = Date.now() - startedAt

    // None of the hung sends ever settle, so a truthful flush cannot claim
    // 'drained' - it must respect the deadline. A hot-spinning wait on
    // `Promise.all([])` for the pruned references would still eventually
    // respect the deadline, but only after burning CPU in a tight loop; a
    // generous wall-clock ceiling here catches that regression without
    // asserting exact timer/microtask counts.
    expect(result.status).toBe('deadline')
    expect(result.remaining).toBe(reconfigurationCount)
    expect(elapsedMs).toBeLessThan(1_000)
    expect(observabilityDiagnostics().reconfiguredRemainingBytes).toBeGreaterThan(0)
  })
})
