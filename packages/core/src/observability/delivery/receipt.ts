import type { CruxGraphRecord, CruxRecordId } from '../contract'

interface CruxDeliveryDispositionBase {
  readonly index: number
  readonly recordId: CruxRecordId
  readonly code: string
  readonly message?: string
}

/** Per-record outcome returned by an observability transport. */
export type CruxDeliveryDisposition =
  | (CruxDeliveryDispositionBase & {
      readonly outcome: 'accepted'
      readonly retryable: false
    })
  | (CruxDeliveryDispositionBase & {
      readonly outcome: 'rejected'
      readonly retryable: boolean
    })

/**
 * Lossless receipt for one transport attempt.
 *
 * Indexes are scoped to the submitted array, so duplicate record IDs remain
 * unambiguous. `retryAfterMs` carries a sanitized transport delay hint.
 */
export interface CruxDeliveryReceipt {
  readonly dispositions: readonly CruxDeliveryDisposition[]
  readonly retryAfterMs?: number
}

/** Cumulative, bounded delivery health propagated out of band from records. */
export interface CruxDeliverySourceHealth {
  readonly sourceId: string
  readonly accepted: number
  readonly retried: number
  readonly permanentlyRejected: number
  readonly overflowDropped: number
  readonly deadlineDropped: number
  readonly lastError?: {
    readonly code: string
    readonly message?: string
  }
}

/** Metadata supplied to a transport for one delivery attempt. */
export interface CruxDeliveryAttemptContext {
  readonly sourceHealth: CruxDeliverySourceHealth
}

export interface PartitionedDeliveryReceipt {
  readonly accepted: readonly CruxGraphRecord[]
  readonly permanentlyRejected: readonly CruxGraphRecord[]
  readonly retryable: readonly CruxGraphRecord[]
  readonly unaccounted: readonly CruxGraphRecord[]
}

/** Create a complete accepted receipt for a submitted record array. */
export function acceptedDeliveryReceipt(records: readonly CruxGraphRecord[]): CruxDeliveryReceipt {
  return {
    dispositions: records.map((record, index) => ({
      index,
      recordId: record.recordId,
      outcome: 'accepted',
      code: 'accepted',
      retryable: false,
    })),
  }
}

/** Create one uniform rejected disposition for every submitted record. */
export function rejectedDeliveryReceipt(
  records: readonly CruxGraphRecord[],
  options: {
    readonly code: string
    readonly message?: string
    readonly retryable: boolean
    readonly retryAfterMs?: number
  },
): CruxDeliveryReceipt {
  return {
    dispositions: records.map((record, index) => ({
      index,
      recordId: record.recordId,
      outcome: 'rejected',
      code: options.code,
      ...(options.message ? { message: options.message } : {}),
      retryable: options.retryable,
    })),
    ...(options.retryAfterMs === undefined ? {} : { retryAfterMs: options.retryAfterMs }),
  }
}

/**
 * Partition a receipt without trusting record IDs alone.
 *
 * Missing, duplicate, malformed, or ID-mismatched indexes are unaccounted and
 * therefore safe to retry. Valid indexes remain independently actionable.
 */
export function partitionDeliveryReceipt(
  records: readonly CruxGraphRecord[],
  receipt: CruxDeliveryReceipt,
): PartitionedDeliveryReceipt {
  const byIndex = new Map<number, CruxDeliveryDisposition[]>()
  for (const disposition of receipt.dispositions) {
    if (!isDisposition(disposition)) continue
    const matches = byIndex.get(disposition.index)
    if (matches) matches.push(disposition)
    else byIndex.set(disposition.index, [disposition])
  }

  const accepted: CruxGraphRecord[] = []
  const permanentlyRejected: CruxGraphRecord[] = []
  const retryable: CruxGraphRecord[] = []
  const unaccounted: CruxGraphRecord[] = []
  records.forEach((record, index) => {
    const matches = byIndex.get(index)
    if (matches?.length !== 1 || matches[0]?.recordId !== record.recordId) {
      unaccounted.push(record)
      return
    }
    const disposition = matches[0]
    if (disposition.outcome === 'accepted') accepted.push(record)
    else if (disposition.retryable) retryable.push(record)
    else permanentlyRejected.push(record)
  })
  return { accepted, permanentlyRejected, retryable, unaccounted }
}

function isDisposition(value: unknown): value is CruxDeliveryDisposition {
  if (!value || typeof value !== 'object') return false
  const disposition = value as {
    index?: unknown
    recordId?: unknown
    outcome?: unknown
    code?: unknown
    retryable?: unknown
  }
  return (
    typeof disposition.index === 'number' &&
    Number.isInteger(disposition.index) &&
    disposition.index >= 0 &&
    typeof disposition.recordId === 'string' &&
    (disposition.outcome === 'accepted' || disposition.outcome === 'rejected') &&
    typeof disposition.code === 'string' &&
    disposition.code.length > 0 &&
    typeof disposition.retryable === 'boolean' &&
    (disposition.outcome !== 'accepted' || disposition.retryable === false)
  )
}
