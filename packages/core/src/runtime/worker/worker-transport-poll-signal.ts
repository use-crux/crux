/**
 * Lease/deadline-bounded AbortSignal for one supervised transport poll.
 *
 * @module
 */

import type { Lease } from "../ports/leases";

/** Derived poll cancellation with deterministic timer/listener cleanup. */
export interface LeaseBoundPollSignal {
  readonly signal: AbortSignal;
  dispose(): void;
}

/**
 * Create a poll AbortSignal that aborts on parent worker abort or when the
 * active binding lease reaches `expiresAt`.
 *
 * @remarks Uses the existing binding lease only — no second lease, renewal,
 * or independent deadline channel. `dispose` clears the deadline timer and
 * parent abort listener.
 */
export function createLeaseBoundPollSignal(
  parent: AbortSignal,
  lease: Lease,
): LeaseBoundPollSignal {
  if (parent.aborted) {
    return {
      signal: parent,
      dispose() {},
    };
  }

  const remainingMs = lease.expiresAt.getTime() - Date.now();
  if (remainingMs <= 0) {
    const expired = new AbortController();
    expired.abort();
    return {
      signal: expired.signal,
      dispose() {},
    };
  }

  const controller = new AbortController();
  const onParentAbort = () => {
    if (!controller.signal.aborted) {
      controller.abort(parent.reason);
    }
  };
  parent.addEventListener("abort", onParentAbort, { once: true });

  const timer = setTimeout(() => {
    if (!controller.signal.aborted) {
      controller.abort();
    }
  }, remainingMs);
  // Avoid keeping the process alive solely for an in-flight poll deadline.
  if (typeof timer.unref === "function") {
    timer.unref();
  }

  let disposed = false;
  return {
    signal: controller.signal,
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      clearTimeout(timer);
      parent.removeEventListener("abort", onParentAbort);
    },
  };
}

/** True when the active binding lease has reached or passed `expiresAt`. */
export function isLeaseExpired(
  lease: Lease,
  nowMs: number = Date.now(),
): boolean {
  return lease.expiresAt.getTime() <= nowMs;
}
