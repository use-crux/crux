import type { WakeEnvelope } from '@use-crux/core/runtime'
import type {
  EventCursor,
  FlowId,
  IdempotencyRecord,
  Lease,
  NewWorkItem,
  RuntimeEvent,
  RuntimeOutboxItem,
  RuntimeTimerRecord,
  RuntimeWaiter,
  WorkId,
  WorkItem,
} from '@use-crux/core/runtime'

const DEFAULT_MAX_ATTEMPTS = 8

export function encodeWorkForCreate(input: NewWorkItem): Record<string, unknown> {
  const now = input.now ?? new Date()
  return clean({
    workId: input.workId,
    namespace: input.namespace,
    work: input.work,
    targetId: input.targetId,
    status: 'pending',
    attempt: 1,
    maxAttempts: input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
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
  return clean({
    ...record,
    workId: record.workId as WorkId,
    notBefore: numberDate(record.notBefore),
    lastError: decodeLastError(record.lastError),
    createdAt: requiredDate(record.createdAt),
    updatedAt: requiredDate(record.updatedAt),
  }) as WorkItem
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
  return clean({
    ...record,
    eventId: String(record.eventId) as EventCursor,
    appendedAt: requiredDate(record.appendedAt),
  }) as RuntimeEvent
}

export function decodeWaiter(value: unknown): RuntimeWaiter {
  const record = objectRecord(value)
  return clean({ ...record, timeoutAt: numberDate(record.timeoutAt) }) as RuntimeWaiter
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

export function encodeWakeEnvelope(envelope: WakeEnvelope): Record<string, unknown> {
  return { ...envelope }
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
  return value as Record<string, unknown>
}

function clean<T extends Record<string, unknown>>(record: T): T {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) as T
}
