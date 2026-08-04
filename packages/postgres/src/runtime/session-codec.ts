import type { JsonValue } from '@use-crux/core'
import { RUNTIME_RESULT_MEDIA_TYPE, type WorkId } from '@use-crux/core/runtime'
import type { StatisticsLedgerExport } from '@use-crux/core/runtime/internal/session-store'
import type {
  RuntimeSessionActivation,
  RuntimeSessionInputRecord,
  RuntimeSessionPreparedExecution,
  RuntimeSessionRecord,
} from './session-types'

type JsonRecord = Record<string, unknown>

/** Decode one normalized PostgreSQL Session control row. */
export function decodeSessionRecord(row: JsonRecord): RuntimeSessionRecord {
  return Object.freeze({
    schemaVersion: 1,
    namespace: requiredString(row.namespace, 'namespace'),
    sessionId: requiredString(row.session_id, 'session_id'),
    keyHash: requiredString(row.key_hash, 'key_hash'),
    targetId: requiredString(row.target_id, 'target_id'),
    threadId: requiredString(row.thread_id, 'thread_id'),
    model: decodeModel(row.model),
    state: sessionState(row.state),
    acceptedCursor: safeInteger(row.accepted_cursor, 'accepted_cursor'),
    ...(row.processed_cursor === null || row.processed_cursor === undefined
      ? {}
      : {
          processedCursor: safeInteger(
            row.processed_cursor,
            'processed_cursor',
          ),
        }),
    pendingInputs: safeInteger(row.pending_inputs, 'pending_inputs'),
    pendingWork: safeInteger(row.pending_work, 'pending_work'),
    blockedWork: safeInteger(row.blocked_work, 'blocked_work'),
    statistics: decodeStatistics(row.statistics),
    wakePending: requiredBoolean(row.wake_pending, 'wake_pending'),
    ...(row.activation ? { activation: decodeActivation(row.activation) } : {}),
    createdAt: timestamp(row.created_at, 'created_at'),
    updatedAt: timestamp(row.updated_at, 'updated_at'),
  })
}

/** Decode one normalized PostgreSQL Session input row. */
export function decodeSessionInputRecord(
  row: JsonRecord,
): RuntimeSessionInputRecord {
  return Object.freeze({
    schemaVersion: 1,
    namespace: requiredString(row.namespace, 'namespace'),
    sessionId: requiredString(row.session_id, 'session_id'),
    inputId: requiredString(row.input_id, 'input_id'),
    cursor: safeInteger(row.cursor, 'cursor'),
    input: jsonValue(row.input, 'input'),
    acceptedAt: timestamp(row.accepted_at, 'accepted_at'),
    ...(row.work ? { work: decodeWork(row.work) } : {}),
    ...(row.delivery ? { delivery: decodeDelivery(row.delivery) } : {}),
    ...(row.prepared_execution
      ? {
          preparedExecution: decodePreparedExecution(row.prepared_execution),
        }
      : {}),
  })
}

function decodeModel(value: unknown): RuntimeSessionRecord['model'] {
  const record = object(value, 'model')
  return Object.freeze({
    definitionId: requiredString(record.definitionId, 'model.definitionId'),
    fingerprint: requiredString(record.fingerprint, 'model.fingerprint'),
  })
}

function decodeActivation(value: unknown): RuntimeSessionActivation {
  const record = object(value, 'activation')
  const state = record.state
  if (state !== 'queued' && state !== 'running') invalid('activation.state')
  return Object.freeze({
    workId: workId(record.workId, 'activation.workId'),
    primaryInputId: requiredString(
      record.primaryInputId,
      'activation.primaryInputId',
    ),
    target: requiredString(record.target, 'activation.target'),
    state,
  })
}

function decodeWork(value: unknown): RuntimeSessionInputRecord['work'] {
  const record = object(value, 'work')
  const state = record.state
  if (
    state !== 'queued' &&
    state !== 'running' &&
    state !== 'completed' &&
    state !== 'blocked'
  ) {
    invalid('work.state')
  }
  return Object.freeze({
    workId: workId(record.workId, 'work.workId'),
    target: requiredString(record.target, 'work.target'),
    state,
  })
}

function decodeDelivery(value: unknown): RuntimeSessionInputRecord['delivery'] {
  const record = object(value, 'delivery')
  const reason = record.reason
  if (
    reason !== 'initial' &&
    reason !== 'tool-result' &&
    reason !== 'validation-retry'
  ) {
    invalid('delivery.reason')
  }
  return Object.freeze({
    stepIndex: safeInteger(record.stepIndex, 'delivery.stepIndex'),
    reason,
    deliveredAt: timestamp(record.deliveredAt, 'delivery.deliveredAt'),
  })
}

export function decodePreparedExecution(
  value: unknown,
): RuntimeSessionPreparedExecution {
  const record = object(value, 'prepared_execution')
  const ref = object(record.preparedResultRef, 'preparedResultRef')
  if (ref.mediaType !== RUNTIME_RESULT_MEDIA_TYPE) {
    invalid('preparedResultRef.mediaType')
  }
  return Object.freeze({
    workId: workId(record.workId, 'preparedExecution.workId'),
    preparedResultRef: Object.freeze({
      sha256: requiredString(ref.sha256, 'preparedResultRef.sha256'),
      size: safeInteger(ref.size, 'preparedResultRef.size'),
      mediaType: ref.mediaType,
      location: requiredString(ref.location, 'preparedResultRef.location'),
    }),
    checkpointedAt: timestamp(
      record.checkpointedAt,
      'preparedExecution.checkpointedAt',
    ),
  })
}

function decodeStatistics(value: unknown): StatisticsLedgerExport {
  const record = object(value, 'statistics')
  const owner = object(record.owner, 'statistics.owner')
  if (record.version !== 1 || owner.kind !== 'session') invalid('statistics')
  return Object.freeze({
    version: 1,
    owner: Object.freeze({
      kind: 'session',
      id: requiredString(owner.id, 'statistics.owner.id'),
    }),
    cursor: safeInteger(record.cursor, 'statistics.cursor'),
    state: requiredString(record.state, 'statistics.state'),
  })
}

function sessionState(value: unknown): RuntimeSessionRecord['state'] {
  if (value !== 'prepared' && value !== 'ready') invalid('state')
  return value
}

function jsonValue(value: unknown, field: string): JsonValue {
  if (isJsonValue(value)) return value
  return invalid(field)
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return true
  }
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJsonValue)
  if (typeof value !== 'object') return false
  return Object.values(value).every(isJsonValue)
}

function object(value: unknown, field: string): JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    invalid(field)
  }
  return Object.fromEntries(Object.entries(value))
}

function workId(value: unknown, field: string): WorkId {
  if (!isWorkId(value)) invalid(field)
  return value
}

function isWorkId(value: unknown): value is WorkId {
  return typeof value === 'string' && value.length > 0
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string') invalid(field)
  return value
}

function requiredBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') invalid(field)
  return value
}

function safeInteger(value: unknown, field: string): number {
  const number = typeof value === 'string' ? Number(value) : value
  if (
    typeof number !== 'number' ||
    !Number.isSafeInteger(number) ||
    number < 0
  ) {
    invalid(field)
  }
  return number
}

function timestamp(value: unknown, field: string): string {
  const date =
    value instanceof Date ? value : new Date(requiredString(value, field))
  if (!Number.isFinite(date.getTime())) invalid(field)
  return date.toISOString()
}

function invalid(field: string): never {
  throw new TypeError(`Stored PostgreSQL Session ${field} is malformed.`)
}
