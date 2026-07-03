/**
 * Stable Runtime Engine idempotency key builders.
 *
 * The kernel uses these keys to make at-least-once wake delivery safe under
 * duplicate queue messages, retry attempts, event replays, and timer scans.
 *
 * @module
 */

import type { EventCursor, TimerId, WaiterId, WorkId } from '../ports/ids'

/** Build the idempotency key for the first runtime flow delivery. */
export function flowStartResumeKey(workId: WorkId): string {
  return `resume:${workId}:start`
}

/** Build the idempotency key for a flow resume caused by a durable event. */
export function flowEventResumeKey(
  workId: WorkId,
  eventId: EventCursor,
): string {
  return `resume:${workId}:${eventId}`
}

/** Build the idempotency key for a flow resume caused by a signal delivery. */
export function flowSignalResumeKey(
  workId: WorkId,
  signalName: string,
  deliveryId: string,
): string {
  return `resume:${workId}:signal:${signalName}:${deliveryId}`
}

/** Build the idempotency key for a manual flow resume request. */
export function flowManualResumeKey(workId: WorkId, now: Date): string {
  return `resume:${workId}:manual:${uniqueInvocationSuffix(now)}`
}

/** Build the idempotency key for an operator retry request. */
export function operatorRetryKey(workId: WorkId, now: Date): string {
  return `retry:${workId}:${uniqueInvocationSuffix(now)}`
}

/** Build the durable audit event name for an operator retry request. */
export function operatorRetryEventName(workId: WorkId): string {
  return `crux.retried:${workId}`
}

/** Build the idempotency key for a timer delivery. */
export function timerKey(timerId: TimerId): string {
  return `timer:${timerId}`
}

/** Build the idempotency key for a waiter timeout with no timer record. */
export function waiterTimeoutKey(waiterId: WaiterId): string {
  return `timer:${waiterId}`
}

/** Build the idempotency key for a task work item. */
export function taskRunKey(workId: WorkId): string {
  return `task:${workId}`
}

/** Build the idempotency key for a workspace/watch cursor delivery. */
export function watchDeliverKey(
  subscriptionId: string,
  cursor: EventCursor,
): string {
  return `watch:${subscriptionId}:${cursor}`
}

function epochMsBase36(now: Date): string {
  return now.getTime().toString(36)
}

let invocationCounter = 0
const invocationNonce = createInvocationNonce()

function uniqueInvocationSuffix(now: Date): string {
  invocationCounter += 1
  return `${epochMsBase36(now)}:${invocationNonce}:${invocationCounter.toString(36)}`
}

function createInvocationNonce(): string {
  const crypto = globalThis.crypto
  if (crypto && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(8)
    crypto.getRandomValues(bytes)
    return [...bytes].map((byte) => byte.toString(36).padStart(2, '0')).join('')
  }
  if (crypto && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replaceAll('-', '').slice(0, 16)
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}
