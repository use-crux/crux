import { afterEach, describe, expect, it } from 'vitest'
import {
  createHttpObservabilityTransport,
  createInMemoryObservabilityTransport,
  observe,
  observabilityDiagnostics,
  resetObservabilityRuntime,
  setObservabilityTransport,
  teeObservabilityTransport,
  type CruxGraphRecord,
} from '../../src/observability'

describe('observability delivery bounds', () => {
  afterEach(() => resetObservabilityRuntime())

  it('enforces queue byte bounds with deterministic overflow accounting', async () => {
    setObservabilityTransport(createInMemoryObservabilityTransport(), {
      scheduledDelayMs: 60_000,
      maxQueuedRecords: 10,
      maxQueuedBytes: 1,
    })

    const run = observe.openRun({ name: 'byte overflow', rootPrimitive: 'custom.operation' })
    run.end()

    await expect(observe.flush()).resolves.toMatchObject({
      delivered: 0,
      remaining: 0,
      rejected: 0,
      deadlineExceeded: false,
    })
    expect(observabilityDiagnostics()).toMatchObject({
      overflowDroppedRecords: 2,
      overflowDroppedBytes: expect.any(Number),
    })
  })

  it('chunks HTTP requests by exact UTF-8 payload bytes', async () => {
    const requestBytes: number[] = []
    const fetchImpl = async (_url: URL | RequestInfo, init?: RequestInit) => {
      const body = String(init?.body)
      requestBytes.push(new TextEncoder().encode(body).byteLength)
      const records = JSON.parse(body).records as CruxGraphRecord[]
      return new Response(
        JSON.stringify({
          dispositions: records.map((record, index) => ({
            index,
            recordId: record.recordId,
            outcome: 'accepted',
            code: 'accepted',
            retryable: false,
          })),
        }),
        { status: 202 },
      )
    }
    const strictTransport = createHttpObservabilityTransport({
        fetch: fetchImpl,
        maxRecordsPerRequest: 100,
        maxRequestBytes: 900,
      })
    const looseTransport = createInMemoryObservabilityTransport()
    const transport = teeObservabilityTransport(looseTransport, strictTransport)
    expect(transport.maxRequestBytes).toBe(900)
    setObservabilityTransport(
      transport,
      { scheduledDelayMs: 60_000 },
    )

    const run = observe.openRun({ name: 'byte chunks', rootPrimitive: 'custom.operation' })
    run.withContext(() => {
      for (let index = 0; index < 4; index += 1) {
        observe.artifact({
          kind: 'output',
          contentType: 'text/plain',
          encoding: 'text',
          preview: `utf8-${index}-🌍`.repeat(8),
        })
      }
    })
    run.end()

    const result = await observe.flush()
    expect(result).toMatchObject({ status: 'drained', remaining: 0 })
    expect(requestBytes.length).toBeGreaterThan(1)
    expect(requestBytes.every((bytes) => bytes <= 900)).toBe(true)
  })

  it('still enforces overflow bounds when a host lifecycle is configured', async () => {
    setObservabilityTransport(createInMemoryObservabilityTransport(), {
      scheduledDelayMs: 60_000,
      maxQueuedRecords: 10,
      maxQueuedBytes: 1,
      hostLifecycle: { deadline: () => Date.now() + 60_000 },
    })

    const run = observe.openRun({ name: 'host lifecycle overflow', rootPrimitive: 'custom.operation' })
    run.end()

    await expect(observe.flush()).resolves.toMatchObject({
      delivered: 0,
      remaining: 0,
      rejected: 0,
      deadlineExceeded: false,
    })
    expect(observabilityDiagnostics()).toMatchObject({
      overflowDroppedRecords: 2,
      overflowDroppedBytes: expect.any(Number),
    })
  })
})
