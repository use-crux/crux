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
