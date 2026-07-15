import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CRUX_OBSERVABILITY_SCHEMA_VERSION,
  createHttpObservabilityTransport,
  observe,
  observabilityDiagnostics,
  resetObservabilityRuntime,
  setObservabilityTransport,
  type CruxDeliveryReceipt,
  type CruxGraphRecord,
  type CruxObservabilityTransport,
} from '../../src/observability'
import { partitionDeliveryReceipt } from '../../src/observability/delivery/receipt'

describe('observability delivery receipts', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    resetObservabilityRuntime()
  })

  it('retries a partial count-only 202 instead of accepting the HTTP status', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            accepted: 1,
            rejected: [{ recordId: 'rec_partial_b', error: 'temporary' }],
          }),
          { status: 202 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ accepted: 2, rejected: [] }), {
          status: 202,
        }),
      )
    setObservabilityTransport(createHttpObservabilityTransport({ fetch: fetchImpl }), {
      scheduledDelayMs: 60_000,
      retryDelayMs: 1,
      maxRetryDelayMs: 1,
      random: () => 0.5,
    })

    await observe.run(
      { name: 'partial count receipt', rootPrimitive: 'custom.operation' },
      async () => undefined,
    )
    const result = await observe.flush()

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({ status: 'drained', delivered: 2, remaining: 0 })
    const attempts = fetchImpl.mock.calls.map(
      (call) => JSON.parse(String(call[1]?.body)).records as CruxGraphRecord[],
    )
    expect(attempts[1]?.map((record) => record.recordId)).toEqual(
      attempts[0]?.map((record) => record.recordId),
    )
  })

  it('partitions mixed receipts and retries only retryable and unaccounted records', async () => {
    vi.useFakeTimers()
    const attempts: CruxGraphRecord[][] = []
    let sendCount = 0
    const transport: CruxObservabilityTransport = {
      maxRecordsPerRequest: 10,
      send(records): CruxDeliveryReceipt {
        attempts.push([...records])
        sendCount += 1
        if (sendCount === 1) {
          return {
            dispositions: [
              acceptedDisposition(records, 0),
              rejectedDisposition(records, 1, false, 'invalid_record'),
              rejectedDisposition(records, 2, true, 'ingest_busy'),
            ],
          }
        }
        return {
          dispositions: records.map((_, index) =>
            acceptedDisposition(records, index),
          ),
        }
      },
    }
    setObservabilityTransport(transport, {
      maxPendingDeliveries: 1,
      scheduledDelayMs: 10,
      retryDelayMs: 1,
      maxRetryDelayMs: 1,
      random: () => 0.5,
    })

    const run = observe.openRun({ name: 'mixed receipt', rootPrimitive: 'custom.operation' })
    run.withContext(() => {
      const span = observe.openSpan({ name: 'mixed span', primitive: 'custom.operation' })
      span.end()
    })
    run.end()

    const flushed = observe.flush()
    await vi.runAllTimersAsync()
    await expect(flushed).resolves.toMatchObject({
      delivered: 3,
      rejected: 1,
      remaining: 0,
      deadlineExceeded: false,
    })
    expect(attempts[1]?.map((record) => record.type)).toEqual(['span:end', 'run:end'])
    expect(observabilityDiagnostics()).toMatchObject({
      acceptedRecords: 3,
      retriedRecords: 2,
      permanentlyRejectedRecords: 1,
      overflowDroppedRecords: 0,
    })
  })

  it('uses indexes to disambiguate duplicate IDs and retries ambiguous dispositions', () => {
    const record = deliveryRecord('rec_duplicate_receipt', 1)
    const records = [record, record]
    const complete = partitionDeliveryReceipt(records, {
      dispositions: [
        acceptedDisposition(records, 0),
        acceptedDisposition(records, 1),
      ],
    })
    expect(complete.accepted).toHaveLength(2)
    expect(complete.unaccounted).toEqual([])

    const ambiguous = partitionDeliveryReceipt(records, {
      dispositions: [
        acceptedDisposition(records, 0),
        acceptedDisposition(records, 0),
        {
          ...acceptedDisposition(records, 1),
          recordId: 'rec_wrong' as typeof record.recordId,
        },
      ],
    })
    expect(ambiguous.accepted).toEqual([])
    expect(ambiguous.unaccounted).toEqual(records)
  })

  it('honors Retry-After before retrying an HTTP request', async () => {
    vi.useFakeTimers()
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response('busy', {
          status: 503,
          headers: { 'Retry-After': '1' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ accepted: 1, rejected: [] }), {
          status: 202,
        }),
      )
    setObservabilityTransport(createHttpObservabilityTransport({ fetch: fetchImpl }), {
      scheduledDelayMs: 0,
      retryDelayMs: 10,
      maxRetryDelayMs: 2_000,
      random: () => 0.5,
    })

    observe.openRun({ name: 'retry after', rootPrimitive: 'custom.operation' })
    await vi.advanceTimersByTimeAsync(0)
    const sent = observe.flush()
    await vi.advanceTimersByTimeAsync(999)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    await expect(sent).resolves.toMatchObject({ status: 'drained' })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})

function deliveryRecord(recordId: string, segmentSeq: number): CruxGraphRecord {
  return {
    schemaVersion: CRUX_OBSERVABILITY_SCHEMA_VERSION,
    recordId,
    type: segmentSeq === 1 ? 'run:start' : 'run:end',
    runId: 'run_delivery_receipt',
    segmentId: 'seg_delivery_receipt',
    segmentSeq,
    traceId: '11111111111111111111111111111111',
    ...(segmentSeq === 1
      ? {
          name: 'delivery receipt',
          rootPrimitive: 'custom.operation',
          startedAt: '2026-05-16T18:00:00.000Z',
          status: 'running',
        }
      : {
          endedAt: '2026-05-16T18:00:00.010Z',
          durationMs: 10,
          status: 'ok',
        }),
  } as CruxGraphRecord
}

function acceptedDisposition(records: readonly CruxGraphRecord[], index: number) {
  return {
    index,
    recordId: records[index]!.recordId,
    outcome: 'accepted' as const,
    code: 'accepted',
    retryable: false as const,
  }
}

function rejectedDisposition(
  records: readonly CruxGraphRecord[],
  index: number,
  retryable: boolean,
  code: string,
) {
  return {
    index,
    recordId: records[index]!.recordId,
    outcome: 'rejected' as const,
    code,
    retryable,
  }
}
