/**
 * Stable Runtime Engine idempotency key builders.
 *
 * The kernel uses these keys to make at-least-once wake delivery safe under
 * duplicate queue messages, retry attempts, event replays, and timer scans.
 *
 * @module
 */

import type { EventCursor, TimerId, WaiterId, WorkId } from '../ports/ids'

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
