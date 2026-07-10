import type { CruxGraphRecord, CruxRunId } from './contract'

export type UnsequencedCruxGraphRecord = CruxGraphRecord extends infer Record
  ? Record extends CruxGraphRecord
    ? Omit<Record, 'seq'>
    : never
  : never

export interface CruxRecordSequencer {
  assign(record: UnsequencedCruxGraphRecord): CruxGraphRecord
  reset(): void
}

const maxRunCounters = 10_000

/**
 * Create a per-run record sequencer for canonical graph emission.
 *
 * Sequence numbers are assigned immediately before validation and fan-out so
 * every public `observe.*` path shares the same ordering contract.
 */
export function createRecordSequencer(): CruxRecordSequencer {
  const counters = new Map<CruxRunId, number>()

  return {
    assign(record) {
      const seq = nextSeq(counters, record.runId)
      const sequenced = { ...record, seq } as CruxGraphRecord
      if (record.type === 'run:end') {
        counters.delete(record.runId)
      }
      return sequenced
    },
    reset() {
      counters.clear()
    },
  }
}

function nextSeq(counters: Map<CruxRunId, number>, runId: CruxRunId): number {
  const current = counters.get(runId) ?? 0
  counters.delete(runId)
  const next = current + 1
  counters.set(runId, next)
  evictOldestCounter(counters)
  return next
}

function evictOldestCounter(counters: Map<CruxRunId, number>): void {
  if (counters.size <= maxRunCounters) return
  const oldestRunId = counters.keys().next().value
  if (oldestRunId) counters.delete(oldestRunId)
}
