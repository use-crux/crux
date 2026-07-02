/**
 * Optional live delivery port contract.
 *
 * Live delivery is best-effort realtime fanout for devtools, watch UIs, and
 * lower-latency polling. It is never correctness-critical; durable event cursor
 * reads must still work when this port is absent.
 *
 * @module
 */

import type { JsonValue } from '../../storage'

/** Best-effort live event delivered to subscribers. */
export interface LiveDeliveryEvent {
  /** Runtime namespace. */
  readonly namespace: string
  /** Logical channel name. */
  readonly channel: string
  /** JSON payload safe for transport dashboards and browser clients. */
  readonly payload: JsonValue
}

/** Optional best-effort live delivery port. */
export interface LiveDeliveryPort {
  /**
   * Publish a best-effort live event.
   *
   * Failures are retryable only as UX latency issues; they must never block a
   * durable state transition or be required for replay correctness.
   */
  publish(event: LiveDeliveryEvent): Promise<void>
}
