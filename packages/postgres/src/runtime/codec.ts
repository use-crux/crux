import type {
  EventCursor,
  FlowId,
  Lease,
  LeaseToken,
  RuntimeEvent,
  RuntimeOutboxItem,
  RuntimeTargetId,
  RuntimeTimerRecord,
  RuntimeWaiter,
  RuntimeDeferredIntent,
  RuntimeDeferredScope,
  DeferredIntentId,
  DeferredScopeId,
  TimerId,
  WaiterId,
  WorkId,
} from '@use-crux/core/runtime'
import type {
  FlowSnapshot,
  RuntimePendingSuspend,
  RuntimeWork,
  WorkItem,
  WorkItemError,
} from '@use-crux/core/runtime'

type JsonRecord = Record<string, unknown>

export function encodeJson(value: unknown): string {
  return JSON.stringify(value)
}

export function decodeWorkItem(row: JsonRecord): WorkItem {
  return Object.freeze({
    workId: row.work_id as WorkId,
    namespace: row.namespace as string,
    work: row.work as RuntimeWork,
    targetId: row.target_id as RuntimeTargetId,
    status: row.status as WorkItem['status'],
    attempt: Number(row.attempt),
    maxAttempts: Number(row.max_attempts),
    idempotencyKey: row.idempotency_key as string,
    ...(row.not_before
      ? { notBefore: new Date(row.not_before as string) }
      : {}),
    ...(typeof row.idle_scope === 'string'
      ? { idleScope: row.idle_scope }
      : {}),
    ...(typeof row.lease_token === 'string'
      ? { leaseToken: row.lease_token as LeaseToken }
      : {}),
    ...withLastError(row.last_error),
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  })
}

export function decodeFlowSnapshot(row: JsonRecord): FlowSnapshot {
  return Object.freeze({
    flowId: row.flow_id as FlowId,
    workId: row.work_id as WorkId,
    targetId: row.target_id as RuntimeTargetId,
    namespace: row.namespace as string,
    status: row.status as FlowSnapshot['status'],
    input: row.input as FlowSnapshot['input'],
    completedSteps: Object.freeze(
      (row.completed_steps as Record<string, FlowSnapshot['input']>) ?? {},
    ),
    fingerprint: Object.freeze([...(row.fingerprint as string[])]),
    pendingSuspends: Object.freeze(
      (row.pending_suspends as RuntimePendingSuspend[]).map((suspend) =>
        Object.freeze({ ...suspend }),
      ),
    ),
    deliveredSuspends: row.delivered_suspends
      ? Object.freeze(
          row.delivered_suspends as NonNullable<
            FlowSnapshot['deliveredSuspends']
          >,
        )
      : undefined,
    scheduledWork: row.scheduled_work ?? row.scheduled_effects
      ? Object.freeze(
          (row.scheduled_work ?? row.scheduled_effects) as NonNullable<
            FlowSnapshot['scheduledWork']
          >,
        )
      : undefined,
    updatedAt: new Date(row.updated_at as string),
  })
}

export function decodeRuntimeEvent(row: JsonRecord): RuntimeEvent {
  return Object.freeze({
    eventId: String(row.event_id) as EventCursor,
    namespace: row.namespace as string,
    name: row.name as string,
    payload: row.payload as RuntimeEvent['payload'],
    appendedAt: new Date(row.appended_at as string),
  })
}

export function decodeWaiter(row: JsonRecord): RuntimeWaiter {
  return Object.freeze({
    waiterId: row.waiter_id as WaiterId,
    namespace: row.namespace as string,
    eventName: row.event_name as string,
    match: Object.freeze(row.match as RuntimeWaiter['match']),
    workId: row.work_id as WorkId | undefined,
    work: row.work as RuntimeWork,
    timeoutAt: row.timeout_at ? new Date(row.timeout_at as string) : undefined,
    timerId: row.timer_id as TimerId | undefined,
    state: row.state as RuntimeWaiter['state'],
  })
}

export function decodeTimer(row: JsonRecord): RuntimeTimerRecord {
  return Object.freeze({
    timerId: row.timer_id as TimerId,
    namespace: row.namespace as string,
    fireAt: new Date(row.fire_at as string),
    workId: row.work_id as WorkId | undefined,
    waiterId: row.waiter_id as WaiterId | undefined,
    idleScope: row.idle_scope as string | undefined,
    work: row.work as RuntimeWork,
    idempotencyKey: row.idempotency_key as string | undefined,
    state: row.state as RuntimeTimerRecord['state'],
  })
}

export function decodeOutbox(row: JsonRecord): RuntimeOutboxItem {
  return Object.freeze({
    outboxId: row.outbox_id as string,
    namespace: row.namespace as string,
    envelope: Object.freeze(row.envelope as RuntimeOutboxItem['envelope']),
    state: row.state as RuntimeOutboxItem['state'],
    attempts: Number(row.attempts),
    nextAttemptAt: new Date(row.next_attempt_at as string),
  })
}

export function decodeLease(row: JsonRecord): Lease {
  return Object.freeze({
    resource: row.resource as string,
    token: row.token as LeaseToken,
    expiresAt: new Date(row.expires_at as string),
    ownerId: row.owner_id as string | undefined,
  })
}

export function decodeDeferredScope(row: JsonRecord): RuntimeDeferredScope {
  const finalization = row.finalization as RuntimeDeferredScope['finalization']
  return Object.freeze({
    namespace: row.namespace as string,
    scopeId: row.scope_id as DeferredScopeId,
    leaseToken: row.lease_token as LeaseToken,
    leaseExpiresAt: new Date(row.lease_expires_at as string),
    finalization:
      finalization.state === 'finalized'
        ? Object.freeze({
            ...finalization,
            finalizedAt: new Date(finalization.finalizedAt),
          })
        : finalization.state === 'abandoned'
          ? Object.freeze({
              ...finalization,
              abandonedAt: new Date(finalization.abandonedAt),
            })
          : Object.freeze({ state: 'open' }),
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  })
}

export function decodeDeferredIntent(row: JsonRecord): RuntimeDeferredIntent {
  return Object.freeze({
    namespace: row.namespace as string,
    scopeId: row.scope_id as DeferredScopeId,
    intentId: row.intent_id as DeferredIntentId,
    workId: row.work_id as WorkId,
    targetId: row.target_id as RuntimeTargetId,
    input: row.input as RuntimeDeferredIntent['input'],
    state: row.state as RuntimeDeferredIntent['state'],
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  })
}

function decodeLastError(value: unknown): WorkItemError | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as { code?: unknown; message?: unknown; at?: unknown }
  if (
    typeof record.code !== 'string' ||
    typeof record.message !== 'string' ||
    typeof record.at !== 'string'
  ) {
    return undefined
  }
  return {
    code: record.code,
    message: record.message,
    at: new Date(record.at),
  }
}

function withLastError(
  value: unknown,
): { readonly lastError: WorkItemError } | Record<string, never> {
  const lastError = decodeLastError(value)
  return lastError ? { lastError } : {}
}
