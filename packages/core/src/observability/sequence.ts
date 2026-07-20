import type { CruxGraphRecord, CruxRunId, CruxSegmentId } from './contract'

export type UnsequencedCruxGraphRecord = CruxGraphRecord extends infer Record
  ? Record extends CruxGraphRecord
    ? Omit<Record, 'segmentSeq' | 'operationId'> & {
        readonly operationId?: CruxRunId
      }
    : never
  : never

export interface CruxRecordSequencer {
  assign(record: UnsequencedCruxGraphRecord): CruxGraphRecord
  reset(): void
}

const maxSegmentCounters = 10_000

/**
 * Create a segment-local record sequencer for ordinary one-segment graph emission.
 *
 * Sequence numbers are assigned immediately before validation and fan-out.
 * They are positive and monotonic only within one execution segment.
 */
export function createRecordSequencer(): CruxRecordSequencer {
  const counters = new Map<CruxSegmentId, number>()

  return {
    assign(record) {
      const segmentSeq = nextSegmentSeq(counters, record.segmentId)
      const sequenced = { ...record, segmentSeq } as CruxGraphRecord
      if (record.type === 'run:suspend' || record.type === 'run:end') {
        counters.delete(record.segmentId)
      }
      return sequenced
    },
    reset() {
      counters.clear()
    },
  }
}

function nextSegmentSeq(
  counters: Map<CruxSegmentId, number>,
  segmentId: CruxSegmentId,
): number {
  const current = counters.get(segmentId) ?? 0
  counters.delete(segmentId)
  const next = current + 1
  counters.set(segmentId, next)
  evictOldestCounter(counters)
  return next
}

function evictOldestCounter(counters: Map<CruxSegmentId, number>): void {
  if (counters.size <= maxSegmentCounters) return
  const oldestSegmentId = counters.keys().next().value
  if (oldestSegmentId) counters.delete(oldestSegmentId)
}
