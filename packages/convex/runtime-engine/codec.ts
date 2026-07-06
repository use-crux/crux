import { DEFAULT_RUNTIME_MAX_ATTEMPTS, type WakeEnvelope } from '@use-crux/core/runtime'
import type {
  EventCursor,
  FlowId,
  IdempotencyRecord,
  Lease,
  NewWorkItem,
  NewRuntimeWaiter,
  RuntimeEvent,
  RuntimeOutboxItem,
  RuntimeTimerRecord,
  RuntimeWaiter,
  WorkId,
  WorkItem,
} from '@use-crux/core/runtime'

const COMPOSITE_DATE_TAG = '$cruxRuntimeDate'

export function encodeWorkForCreate(input: NewWorkItem): Record<string, unknown> {
  const now = input.now ?? new Date()
  return clean({
    workId: input.workId,
    namespace: input.namespace,
    work: input.work,
    targetId: input.targetId,
    status: 'pending',
    attempt: 1,
    maxAttempts: input.maxAttempts ?? DEFAULT_RUNTIME_MAX_ATTEMPTS,
    notBefore: input.notBefore?.getTime(),
    idempotencyKey: input.idempotencyKey,
    idleScope: input.idleScope,
    createdAt: now.getTime(),
    updatedAt: now.getTime(),
  })
}

export function encodeWork(work: WorkItem): Record<string, unknown> {
  return clean({
    ...work,
    notBefore: work.notBefore?.getTime(),
    lastError: work.lastError ? { ...work.lastError, at: work.lastError.at.getTime() } : undefined,
    createdAt: work.createdAt.getTime(),
    updatedAt: work.updatedAt.getTime(),
  })
}

export function decodeWork(value: unknown): WorkItem {
  const record = objectRecord(value)
  return Object.freeze(clean({
    ...record,
    workId: record.workId as WorkId,
    notBefore: numberDate(record.notBefore),
    lastError: decodeLastError(record.lastError),
    createdAt: requiredDate(record.createdAt),
    updatedAt: requiredDate(record.updatedAt),
  }) as WorkItem)
}

export function encodeSnapshot(snapshot: object & { readonly updatedAt: Date }): Record<string, unknown> {
  return clean({ ...snapshot, updatedAt: snapshot.updatedAt.getTime() })
}

export function decodeSnapshot<T>(value: unknown): T {
  const record = objectRecord(value)
  return clean({ ...record, updatedAt: requiredDate(record.updatedAt) }) as T
}

export function encodeEvent(event: object): Record<string, unknown> {
  return clean({ ...event })
}

export function decodeEvent(value: unknown): RuntimeEvent {
  const record = objectRecord(value)
  const { eventKey, ...event } = record
  void eventKey
  return clean({
    ...event,
    eventId: String(event.eventId) as EventCursor,
    appendedAt: requiredDate(event.appendedAt),
  }) as RuntimeEvent
}

export function decodeWaiter(value: unknown): RuntimeWaiter {
  const record = objectRecord(value)
  return clean({ ...record, timeoutAt: numberDate(record.timeoutAt) }) as RuntimeWaiter
}

export function encodeWaiter(waiter: NewRuntimeWaiter): Record<string, unknown> {
  return clean({
    ...waiter,
    timeoutAt: waiter.timeoutAt?.getTime(),
  })
}

export function encodeTimer(timer: object & { readonly fireAt: Date }): Record<string, unknown> {
  return clean({ ...timer, fireAt: timer.fireAt.getTime() })
}

export function decodeTimer(value: unknown): RuntimeTimerRecord {
  const record = objectRecord(value)
  return clean({ ...record, fireAt: requiredDate(record.fireAt) }) as RuntimeTimerRecord
}

export function encodeOutboxDate(date: Date): number {
  return date.getTime()
}

export function decodeOutbox(value: unknown): RuntimeOutboxItem {
  const record = objectRecord(value)
  return clean({ ...record, nextAttemptAt: requiredDate(record.nextAttemptAt) }) as RuntimeOutboxItem
}

export function encodeIdempotency(record: IdempotencyRecord): Record<string, unknown> {
  return { ...record, completedAt: record.completedAt.getTime() }
}

export function decodeLease(value: unknown): Lease | null {
  if (value === null) return null
  const record = objectRecord(value)
  return clean({ ...record, expiresAt: requiredDate(record.expiresAt) }) as Lease
}

export function encodeLease(lease: Lease): Record<string, unknown> {
  return clean({ ...lease, expiresAt: lease.expiresAt.getTime() })
}

export function encodeWakeEnvelope(envelope: WakeEnvelope): Record<string, unknown> {
  return { ...envelope }
}

/** Encode a composite payload for transport through Convex `v.any()`. */
export function encodeCompositeValue(value: unknown): unknown {
  if (value instanceof Date) {
    return { [COMPOSITE_DATE_TAG]: value.getTime() }
  }
  if (Array.isArray(value)) {
    return value.map((item) => encodeCompositeValue(item))
  }
  if (!value || typeof value !== 'object') {
    return value
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      encodeCompositeValue(entry),
    ]),
  )
}

/** Decode a composite payload transported through Convex `v.any()`. */
export function decodeCompositeValue<T>(value: unknown): T {
  return decodeCompositeUnknown(value) as T
}

function decodeCompositeUnknown(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => decodeCompositeUnknown(item))
  }
  if (!value || typeof value !== 'object') {
    return value
  }
  const record = value as Record<string, unknown>
  if (
    Object.keys(record).length === 1 &&
    typeof record[COMPOSITE_DATE_TAG] === 'number'
  ) {
    return new Date(record[COMPOSITE_DATE_TAG])
  }
  return Object.fromEntries(
    Object.entries(record).map(([key, entry]) => [
      key,
      decodeCompositeUnknown(entry),
    ]),
  )
}

function decodeLastError(value: unknown): WorkItem['lastError'] {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  return {
    code: String(record.code),
    message: String(record.message),
    at: requiredDate(record.at),
  }
}

function numberDate(value: unknown): Date | undefined {
  return typeof value === 'number' ? new Date(value) : undefined
}

function requiredDate(value: unknown): Date {
  if (value instanceof Date) return new Date(value)
  if (typeof value === 'number') return new Date(value)
  throw new Error('Expected encoded runtime date.')
}

function objectRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') throw new Error('Expected runtime record.')
  const { _id, _creationTime, ...record } = value as Record<string, unknown>
  void _id
  void _creationTime
  return record
}

function clean<T extends Record<string, unknown>>(record: T): T {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) as T
}
