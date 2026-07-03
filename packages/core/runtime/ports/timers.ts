/**
 * Durable timer port contract.
 *
 * Timers deliver runtime work no earlier than a future deadline. Delivery may
 * be late and may happen more than once; the kernel's idempotency key for the
 * timer gates correctness.
 *
 * @module
 */

import type { TimerId } from './ids'
import type { RuntimeWork } from './work'

/** Options for scheduling future runtime work. */
export interface TimerOptions {
  /** Stable duplicate scheduling key. */
  readonly idempotencyKey?: string
}

/** Durable timer scheduling port. */
export interface DurableTimerPort {
  /**
   * Schedule future delivery of runtime work.
   *
   * The timer is durable before this method resolves. Timer ids are generated
   * by the adapter and become part of the kernel idempotency key.
   */
  schedule(
    work: RuntimeWork,
    dueAt: Date,
    options?: TimerOptions,
  ): Promise<TimerId>

  /**
   * Cancel a scheduled timer.
   *
   * Cancellation is idempotent. Late duplicate timer delivery is allowed and
   * must be treated as a no-op by the kernel.
   */
  cancel(timerId: TimerId): Promise<void>
}
