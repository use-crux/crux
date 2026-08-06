/** Pure Session lifecycle predicates shared by Runtime adapters and composites. */

import type { RuntimeSessionLifecycleState } from "../runtime/ports/sessions";

/**
 * Whether external send/subscribe may still accept new roots.
 *
 * @remarks Only fully ready Sessions accept ingress. Closing seals the barrier.
 */
export function sessionAcceptsIngress(
  state: RuntimeSessionLifecycleState,
): boolean {
  return state === "ready";
}

/**
 * Whether Session-owned Work may still mutate ledger state or claim inputs.
 *
 * @remarks Ready and closing (drain) retain commit authority for already
 * admitted obligations. Killed, closed, and deleted Sessions do not.
 */
export function sessionHoldsCommitAuthority(
  state: RuntimeSessionLifecycleState,
): boolean {
  return state === "ready" || state === "closing";
}

/**
 * Whether Signal publication may fan out to this Session's subscriptions.
 *
 * @remarks Closed, killed, deleted, and sealing Sessions never receive fan-out.
 * Close also deactivates subscriptions at the barrier; this is defense in depth.
 */
export function sessionAcceptsSignalFanout(
  state: RuntimeSessionLifecycleState,
): boolean {
  return state === "ready";
}

/** Terminal readable or tombstoned lifecycle states. */
export function isSessionTerminalLifecycle(
  state: RuntimeSessionLifecycleState,
): boolean {
  return state === "closed" || state === "killed" || state === "deleted";
}
