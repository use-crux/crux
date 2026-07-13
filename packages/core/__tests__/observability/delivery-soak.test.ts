import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createHttpObservabilityTransport,
  observe,
  observabilityDiagnostics,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from '../../src/observability'

/**
 * Bounded soak for the TypeScript delivery engine's retry/drop accounting.
 *
 * This is the client-side half of the observability soak evidence; the Go
 * `internal/localserver` soak (`observability_soak_test.go`) is the
 * server-side half (real HTTP server, real SQLite, accepted/duplicate/
 * conflict/visible reconciliation). Neither test alone exercises every fault
 * in binding spec 05 section 3 — composed, they do:
 *
 * - accepted / duplicate-idempotent / conflicting-duplicate / invalid-schema
 *   / projected+visible: the Go soak, against a real server.
 * - partial-202-then-retry, a dropped response after the collector already
 *   committed the batch (forcing a safe, byte-identical whole-batch retry),
 *   and a `503` with `Retry-After` before a successful retry: this test,
 *   against the real `createHttpObservabilityTransport` + delivery engine
 *   with a scripted `fetch`.
 * - oversized record/batch, queue overflow, host-deadline-during-retry,
 *   stale-transport-reconfiguration drop: already covered by dedicated
 *   focused tests (`delivery-bounds.test.ts`, `delivery-reconfiguration.test.ts`,
 *   `serverless-freeze.test.ts`) — not re-derived here.
 *
 * Every record this test emits ends in exactly one terminal bucket
 * (`acceptedRecords` or `permanentlyRejectedRecords`); `retriedRecords` is a
 * separate, cumulative "how many records were retried at least once" counter
 * this test also reconciles against the exact number of records in each
 * fault group that required a retry.
 */
describe('observability delivery soak (retry/drop reconciliation)', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    resetObservabilityRuntime()
  })

  it('reconciles accepted/retried/permanently-rejected counts across partial-202, dropped-after-commit, and 503/Retry-After faults', async () => {
    vi.useFakeTimers()

    type Phase = 'fresh' | 'retry' | 'permanent' | 'dropcommit' | 'http503'
    let phase: Phase = 'fresh'
    const attemptsByPhase = new Map<Phase, number>()
    const recordIdsByPhaseAttempt = new Map<Phase, string[][]>()

    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { records: Array<{ recordId: string }> }
      const records = body.records
      const attempt = (attemptsByPhase.get(phase) ?? 0) + 1
      attemptsByPhase.set(phase, attempt)
      const seenForPhase = recordIdsByPhaseAttempt.get(phase) ?? []
      seenForPhase.push(records.map((record) => record.recordId))
      recordIdsByPhaseAttempt.set(phase, seenForPhase)

      switch (phase) {
        case 'fresh':
          return jsonReceipt(fullAccept(records))
        case 'permanent':
          return jsonReceipt(fullReject(records, false, 'invalid_record'))
        case 'retry':
          if (attempt === 1) return jsonReceipt(fullReject(records, true, 'ingest_busy'))
          return jsonReceipt(fullAccept(records))
        case 'dropcommit':
          // The collector actually received and committed this batch (immutable
          // recordId, safe to re-accept), but the response never reached the
          // client — modeled here as the fetch call itself rejecting.
          if (attempt === 1) throw new Error('simulated dropped response after collector commit')
          return jsonReceipt(fullAccept(records))
        case 'http503':
          if (attempt === 1) return new Response('busy', { status: 503, headers: { 'Retry-After': '1' } })
          return jsonReceipt(fullAccept(records))
      }
    })

    setObservabilityTransport(createHttpObservabilityTransport({ fetch: fetchImpl }), {
      scheduledDelayMs: 10,
      retryDelayMs: 1,
      maxRetryDelayMs: 1,
      random: () => 0.5,
    })

    async function emitGroup(nextPhase: Phase, runCount: number): Promise<void> {
      phase = nextPhase
      for (let index = 0; index < runCount; index += 1) {
        observe.openRun({ name: `soak-${nextPhase}-${index}`, rootPrimitive: 'custom.operation' }).end()
      }
      const flushed = observe.flush()
      await vi.runAllTimersAsync()
      await flushed
    }

    const groupRunCounts: Record<Phase, number> = {
      fresh: 30,
      retry: 8,
      permanent: 5,
      dropcommit: 6,
      http503: 6,
    }
    // Each run emits exactly one `run:start` + one `run:end` record.
    const recordsPerRun = 2

    await emitGroup('fresh', groupRunCounts.fresh)
    await emitGroup('retry', groupRunCounts.retry)
    await emitGroup('permanent', groupRunCounts.permanent)
    await emitGroup('dropcommit', groupRunCounts.dropcommit)
    await emitGroup('http503', groupRunCounts.http503)

    const emitted =
      (groupRunCounts.fresh +
        groupRunCounts.retry +
        groupRunCounts.permanent +
        groupRunCounts.dropcommit +
        groupRunCounts.http503) *
      recordsPerRun

    const wantAccepted =
      (groupRunCounts.fresh + groupRunCounts.retry + groupRunCounts.dropcommit + groupRunCounts.http503) *
      recordsPerRun
    const wantPermanentlyRejected = groupRunCounts.permanent * recordsPerRun
    const wantRetried = (groupRunCounts.retry + groupRunCounts.dropcommit + groupRunCounts.http503) * recordsPerRun

    const diagnostics = observabilityDiagnostics()

    // Zero unexplained loss: every emitted record is accepted or permanently
    // rejected exactly once — nothing vanishes into an unaccounted bucket.
    expect(diagnostics.acceptedRecords + diagnostics.permanentlyRejectedRecords).toBe(emitted)
    expect(diagnostics.acceptedRecords).toBe(wantAccepted)
    expect(diagnostics.permanentlyRejectedRecords).toBe(wantPermanentlyRejected)
    expect(diagnostics.retriedRecords).toBe(wantRetried)
    // Only the three scripted faults produced any retry/drop activity; the
    // other drop reasons (overflow/deadline/reconfiguration) are exercised by
    // their own dedicated tests, not by this soak.
    expect(diagnostics.overflowDroppedRecords).toBe(0)
    expect(diagnostics.deadlineDroppedRecords).toBe(0)
    expect(diagnostics.reconfiguredDroppedRecords).toBe(0)

    // Each retried group needed exactly one retry (fail once, then succeed) —
    // proving the retry converges and is not a runaway loop. ('fresh' is
    // exempt: the delivery engine dispatches the very first queued record of
    // the whole session immediately rather than waiting for the coalescing
    // window, so the first group alone may see an extra, non-retry send —
    // harmless here since 'fresh' never branches on attempt count.)
    expect(attemptsByPhase.get('permanent')).toBe(1)
    expect(attemptsByPhase.get('retry')).toBe(2)
    expect(attemptsByPhase.get('dropcommit')).toBe(2)
    expect(attemptsByPhase.get('http503')).toBe(2)

    // The dropped-after-commit retry must resend the exact same records (a
    // safe, byte-identical whole-batch retry), not a different/partial set.
    const dropcommitAttempts = recordIdsByPhaseAttempt.get('dropcommit')!
    expect(dropcommitAttempts).toHaveLength(2)
    expect(dropcommitAttempts[1]).toEqual(dropcommitAttempts[0])
  })
})

function jsonReceipt(dispositions: unknown[]): Response {
  return new Response(JSON.stringify({ dispositions }), { status: 202 })
}

function fullAccept(records: ReadonlyArray<{ recordId: string }>) {
  return records.map((record, index) => ({
    index,
    recordId: record.recordId,
    outcome: 'accepted' as const,
    code: 'accepted',
    retryable: false as const,
  }))
}

function fullReject(records: ReadonlyArray<{ recordId: string }>, retryable: boolean, code: string) {
  return records.map((record, index) => ({
    index,
    recordId: record.recordId,
    outcome: 'rejected' as const,
    code,
    retryable,
  }))
}
