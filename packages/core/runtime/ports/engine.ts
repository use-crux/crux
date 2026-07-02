/**
 * Composed Runtime Engine adapter contract.
 *
 * All-in-one adapters such as Convex can expose every required port together.
 * Composite runtimes build the same shape from store, wake, timer, lease, and
 * optional live pieces.
 *
 * @module
 */

import type { CruxEngineCapabilities } from './capabilities'
import type { DurableEventPort } from './events'
import type { LeasePort } from './leases'
import type { LiveDeliveryPort } from './live'
import type { RuntimeSetupPort } from './setup'
import type { RuntimeStatePort } from './state'
import type { DurableTaskPort } from './tasks'
import type { DurableTimerPort } from './timers'
import type { WaiterPort } from './waiters'

/** Fully composed Runtime Engine adapter. */
export interface CruxRuntimeEngine {
  /** Stable adapter id used in diagnostics and conformance output. */
  readonly id: string
  /** Adapter capability declaration used by preflight and runtime checks. */
  readonly capabilities: CruxEngineCapabilities
  /** Optional setup verification/provisioning port. */
  readonly setup?: RuntimeSetupPort
  /** Durable state for work, snapshots, idempotency, and counters. */
  readonly state: RuntimeStatePort
  /** Durable append/read events. */
  readonly events: DurableEventPort
  /** Durable event-to-work waiter correlation. */
  readonly waiters: WaiterPort
  /** At-least-once work delivery. */
  readonly tasks: DurableTaskPort
  /** Durable future work scheduling. */
  readonly timers: DurableTimerPort
  /** Durable leases for concurrent workers. */
  readonly leases: LeasePort
  /** Optional best-effort realtime delivery. */
  readonly live?: LiveDeliveryPort
}
