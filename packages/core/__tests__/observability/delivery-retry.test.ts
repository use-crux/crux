import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  configureObservability,
  currentObservabilityTransport,
  observe,
  observabilityDiagnostics,
  resetObservabilityRuntime,
  setObservabilityTransport,
  teeObservabilityTransport,
  type CruxGraphRecord,
  type CruxObservabilityTransport,
} from '../../observability'
import { chaosTransport } from './helpers/chaos-transport'

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
    const devtoolsTransport: CruxObservabilityTransport = { send: vi.fn() }
    const captureTransport: CruxObservabilityTransport = { send: vi.fn() }

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
      send: vi.fn(),
      async flush() {
        calls.push('first:flush')
      },
      async shutdown() {
        calls.push('first:shutdown')
      },
    }
    const second: CruxObservabilityTransport = {
      maxRecordsPerRequest: 3,
      send: vi.fn(),
      async flush() {
        calls.push('second:flush')
      },
      async shutdown() {
        calls.push('second:shutdown')
      },
    }
    const tee = teeObservabilityTransport(first, second)

    expect(tee.maxRecordsPerRequest).toBe(3)
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
    await observe.flush()

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
    await observe.flush()

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
