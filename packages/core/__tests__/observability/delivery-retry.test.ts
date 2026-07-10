import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  acceptedDeliveryReceipt,
  configureObservability,
  currentObservabilityTransport,
  observe,
  observabilityDiagnostics,
  resetObservabilityRuntime,
  setObservabilityTransport,
  teeObservabilityTransport,
  type CruxGraphRecord,
  type CruxObservabilityTransport,
} from '../../src/observability'
import type { CruxHostLifecycle } from '../../src/runtime/public'
import { chaosTransport } from './helpers/chaos-transport'

function fakeHostLifecycle(): CruxHostLifecycle & { deferred: Promise<void>[] } {
  const deferred: Promise<void>[] = []
  return {
    deferred,
    defer(task) {
      deferred.push(task)
    },
  }
}

describe('observability delivery retry and configuration restore', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    resetObservabilityRuntime()
  })

  it('retries a failed delivery after backoff without another emit', async () => {
    vi.useFakeTimers()
    const chaos = chaosTransport('flap')
    setObservabilityTransport(chaos.transport, {
      maxPendingDeliveries: 1,
      scheduledDelayMs: 0,
      retryDelayMs: 10,
      maxRetryDelayMs: 10,
      random: () => 0.5,
    })

    observe.openRun({ name: 'flapping collector', rootPrimitive: 'custom.operation' })
    await vi.advanceTimersByTimeAsync(0)

    expect(chaos.sendCount).toBe(1)
    expect(observabilityDiagnostics().deliveryErrors).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(9)
    expect(chaos.sendCount).toBe(1)

    await vi.advanceTimersByTimeAsync(1)
    expect(chaos.sendCount).toBe(2)
    expect(chaos.batches.at(-1)?.map((record) => record.type)).toEqual(['run:start'])
  })

  it('drops stale in-flight failures after reset instead of sending them to the new transport', async () => {
    const first = chaosTransport('reject')
    setObservabilityTransport(first.transport, { maxPendingDeliveries: 1 })

    observe.openRun({ name: 'old runtime', rootPrimitive: 'custom.operation' })
    resetObservabilityRuntime()

    const delivered: CruxGraphRecord[] = []
    setObservabilityTransport({
      send(records) {
        delivered.push(...records)
        return acceptedDeliveryReceipt(records)
      },
    })

    await Promise.resolve()
    await observe.flush()

    expect(delivered).toEqual([])
    expect(observabilityDiagnostics()).toMatchObject({
      pendingDeliveries: 0,
      droppedRecords: 1,
    })
  })

  it('does not resurrect a disposed transport after interleaved restores', () => {
    const devtoolsTransport: CruxObservabilityTransport = { send: acceptedDeliveryReceipt }
    const captureTransport: CruxObservabilityTransport = { send: acceptedDeliveryReceipt }

    const restoreDevtools = configureObservability({ transport: devtoolsTransport })
    const restoreCapture = configureObservability({
      transport: teeObservabilityTransport(captureTransport, currentObservabilityTransport()!),
    })

    restoreDevtools()
    expect(currentObservabilityTransport()).toBeUndefined()

    restoreCapture()
    expect(currentObservabilityTransport()).toBeUndefined()
  })

  it('tees records to every transport while isolating one failing leg', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const delivered: CruxGraphRecord[] = []
    const failing: CruxObservabilityTransport = {
      send() {
        throw new Error('tee leg failed')
      },
    }
    const receiving: CruxObservabilityTransport = {
      send(records) {
        delivered.push(...records)
        return acceptedDeliveryReceipt(records)
      },
    }

    setObservabilityTransport(teeObservabilityTransport(failing, receiving))
    await observe.run({ name: 'tee run', rootPrimitive: 'custom.operation' }, async () => 'ok')
    await observe.flush()

    expect(delivered.map((record) => record.type)).toEqual(['run:start', 'run:end'])
    expect(observabilityDiagnostics().deliveryErrors).toEqual([])
    expect(warn).toHaveBeenCalledWith(
      '[crux] observability tee transport leg failed; continuing with successful leg(s).',
      expect.any(Error),
    )
  })

  it('forwards tee transport hooks and exposes the strictest chunk size', async () => {
    const calls: string[] = []
    const first: CruxObservabilityTransport = {
      maxRecordsPerRequest: 8,
      maxRequestBytes: 2_000,
      send: acceptedDeliveryReceipt,
      async flush() {
        calls.push('first:flush')
      },
      async shutdown() {
        calls.push('first:shutdown')
      },
    }
    const second: CruxObservabilityTransport = {
      maxRecordsPerRequest: 3,
      maxRequestBytes: 900,
      send: acceptedDeliveryReceipt,
      async flush() {
        calls.push('second:flush')
      },
      async shutdown() {
        calls.push('second:shutdown')
      },
    }
    const tee = teeObservabilityTransport(first, second)

    expect(tee.maxRecordsPerRequest).toBe(3)
    expect(tee.maxRequestBytes).toBe(900)
    await expect(tee.flush?.()).resolves.toBeUndefined()
    await expect(tee.shutdown?.()).resolves.toBeUndefined()
    expect(calls).toEqual(['first:flush', 'second:flush', 'first:shutdown', 'second:shutdown'])
  })

  it('does not over-drop a failed in-flight batch when requeueing at the queue bound', async () => {
    vi.useFakeTimers()
    let sendCount = 0
    const delivered: CruxGraphRecord[] = []
    setObservabilityTransport(
      {
        async send(records) {
          sendCount += 1
          if (sendCount === 1) throw new Error('temporary pressure failure')
          delivered.push(...records)
          return acceptedDeliveryReceipt(records)
        },
      },
      {
        maxPendingDeliveries: 1,
        maxQueuedRecords: 4,
        maxBatchSize: 4,
        scheduledDelayMs: 0,
        retryDelayMs: 1,
        maxRetryDelayMs: 1,
      },
    )

    const run = observe.openRun({ name: 'bounded requeue', rootPrimitive: 'custom.operation' })
    run.withContext(() => {
      const span = observe.openSpan({ name: 'queued span', primitive: 'custom.operation' })
      span.end()
    })
    run.end()

    await vi.advanceTimersByTimeAsync(1)
    const flushed = observe.flush()
    await vi.runAllTimersAsync()
    await flushed

    expect(delivered.map((record) => record.type)).toEqual(['run:start', 'span:start', 'span:end', 'run:end'])
    expect(observabilityDiagnostics()).toMatchObject({
      droppedRecords: 0,
      deliveryErrorCount: 1,
    })
  })

  it('requeues only the failed and later chunks after a partial transport failure', async () => {
    vi.useFakeTimers()
    const chaos = chaosTransport('partial-chunk-fail')
    Object.assign(chaos.transport, { maxRecordsPerRequest: 2 })
    setObservabilityTransport(chaos.transport, {
      maxPendingDeliveries: 1,
      scheduledDelayMs: 1,
      retryDelayMs: 1,
      maxRetryDelayMs: 1,
    })

    const run = observe.openRun({ name: 'chunked delivery', rootPrimitive: 'custom.operation' })
    run.withContext(() => {
      for (const label of ['artifact 1', 'artifact 2', 'artifact 3', 'artifact 4']) {
        observe.artifact({
          kind: 'output',
          contentType: 'text/plain',
          encoding: 'text',
          preview: label,
        })
      }
    })
    run.end()

    await vi.advanceTimersByTimeAsync(1)
    const flushed = observe.flush()
    await vi.runAllTimersAsync()
    await flushed

    expect(chaos.batches.map((batch) => batch.map((record) => record.type))).toEqual([
      ['run:start', 'artifact'],
      ['artifact', 'artifact'],
      ['artifact', 'artifact'],
      ['artifact', 'run:end'],
    ])
    expect(chaos.batches[1]?.[0]).toMatchObject({ type: 'artifact', preview: 'artifact 2' })
    expect(chaos.batches[2]?.[0]).toMatchObject({ type: 'artifact', preview: 'artifact 2' })
    expect(observabilityDiagnostics().deliveryErrors).toHaveLength(1)
  })
})

describe('observability delivery host lifecycle binding', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    resetObservabilityRuntime()
  })

  it('binds every send and retry task to the configured host defer capability', async () => {
    const host = fakeHostLifecycle()
    const chaos = chaosTransport('flap')
    setObservabilityTransport(chaos.transport, {
      scheduledDelayMs: 0,
      retryDelayMs: 0,
      maxRetryDelayMs: 0,
      hostLifecycle: host,
    })

    observe.openRun({ name: 'deferred run', rootPrimitive: 'custom.operation' })
    await observe.flush()

    expect(host.deferred.length).toBeGreaterThanOrEqual(2)
    await Promise.all(host.deferred)
  })

  it('binds the retry backoff wait itself to host defer, not only the eventual retry send', async () => {
    vi.useFakeTimers()
    const host = fakeHostLifecycle()
    const chaos = chaosTransport('flap')
    setObservabilityTransport(chaos.transport, {
      scheduledDelayMs: 0,
      retryDelayMs: 20,
      maxRetryDelayMs: 20,
      hostLifecycle: host,
    })

    observe.openRun({ name: 'covered backoff', rootPrimitive: 'custom.operation' })
    // Let the first send fail and the retry get scheduled, without letting
    // the 20ms backoff timer itself fire yet.
    await vi.advanceTimersByTimeAsync(0)

    // A bare unref'd timer would leave nothing deferred during the backoff
    // window, so a host that freezes the process based only on outstanding
    // deferred work could kill it before the retry ever fires. The wait
    // itself - covering the backoff period, not just the eventual resend -
    // must already be registered with the host at this point.
    const deferredDuringBackoff = host.deferred.length
    expect(deferredDuringBackoff).toBeGreaterThanOrEqual(2)

    await vi.advanceTimersByTimeAsync(20)
    await Promise.resolve()
    await Promise.resolve()

    // Once the retry fires and sends successfully, its own send promise is
    // deferred too - the backoff wait did not silently stand in for it.
    expect(host.deferred.length).toBeGreaterThan(deferredDuringBackoff)
    await Promise.all(host.deferred)
    expect(observabilityDiagnostics().acceptedRecords).toBe(1)
  })

  it('defers each concurrent in-flight delivery independently', () => {
    const host = fakeHostLifecycle()
    const chaos = chaosTransport('slow')
    setObservabilityTransport(chaos.transport, {
      scheduledDelayMs: 0,
      maxPendingDeliveries: 4,
      maxBatchSize: 1,
      hostLifecycle: host,
    })

    observe.openRun({ name: 'concurrent a', rootPrimitive: 'custom.operation' })
    observe.openRun({ name: 'concurrent b', rootPrimitive: 'custom.operation' })

    expect(host.deferred.length).toBe(2)
    chaos.resolveSlowDeliveries()
  })

  it('reuses the same host defer capability across multiple dispatch cycles', async () => {
    const host = fakeHostLifecycle()
    setObservabilityTransport(
      { send: acceptedDeliveryReceipt },
      { scheduledDelayMs: 0, hostLifecycle: host },
    )

    const first = observe.openRun({ name: 'warm 1', rootPrimitive: 'custom.operation' })
    first.end()
    await Promise.resolve()

    const second = observe.openRun({ name: 'warm 2', rootPrimitive: 'custom.operation' })
    second.end()
    await Promise.resolve()

    expect(host.deferred.length).toBeGreaterThanOrEqual(2)
    await Promise.all(host.deferred)
  })

  it('bounds flush by the host deadline even without an explicit timeoutMs', async () => {
    vi.useFakeTimers()
    const chaos = chaosTransport('reject')
    const host: CruxHostLifecycle = { deadline: () => Date.now() + 5 }
    setObservabilityTransport(chaos.transport, {
      scheduledDelayMs: 0,
      retryDelayMs: 1,
      maxRetryDelayMs: 1,
      hostLifecycle: host,
    })

    observe.openRun({ name: 'host deadline flush', rootPrimitive: 'custom.operation' })
    const flushed = observe.flush()
    await vi.advanceTimersByTimeAsync(20)
    const result = await flushed

    expect(result.status).toBe('deadline')
    expect(result.deadlineExceeded).toBe(true)
  })

  it('bounds a graceful shutdown by the host deadline instead of hanging forever', async () => {
    vi.useFakeTimers()
    const chaos = chaosTransport('hang')
    const host: CruxHostLifecycle = { deadline: () => Date.now() + 5 }
    setObservabilityTransport(chaos.transport, { scheduledDelayMs: 0, hostLifecycle: host })

    observe.openRun({ name: 'host deadline shutdown', rootPrimitive: 'custom.operation' })
    const shutdown = observe.shutdown()
    await vi.advanceTimersByTimeAsync(20)
    const result = await shutdown

    expect(result.status).toBe('deadline')
    expect(result.remaining).toBeGreaterThan(0)
  })

  // Reconfiguration-epoch/superseded-delivery accounting cases live in
  // delivery-reconfiguration.test.ts to keep this file focused on retry and
  // host lifecycle binding.
})
