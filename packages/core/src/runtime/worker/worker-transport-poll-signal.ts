/**
 * Lease/deadline-bounded AbortSignal for one supervised transport poll.
 *
 * @module
 */

import type { Lease } from "../ports/leases";

/** Derived poll cancellation with deterministic timer/listener cleanup. */
export interface LeaseBoundPollSignal {
  readonly signal: AbortSignal;
  /**
   * Reset the lease deadline after a successful {@link LeasePort.extend}.
   *
   * @remarks Stream fibers hold leases across worker ticks. Supervision extends
   * the store lease and calls `refresh` so long-lived connections are not
   * aborted by a stale process-local `expiresAt` while the fence remains held.
   * No-op when already aborted or disposed.
   */
  refresh(lease: Lease): void;
  dispose(): void;
}

/**
 * Create a poll AbortSignal that aborts on parent worker abort or when the
 * active binding lease reaches `expiresAt`.
 *
 * @remarks Uses the existing binding lease only — no second lease type or
 * independent deadline channel. `dispose` clears the deadline timer and
 * parent abort listener. Call {@link LeaseBoundPollSignal.refresh} after lease
 * extension so stream fibers keep the deadline aligned with the store fence.
 */
export function createLeaseBoundPollSignal(
  parent: AbortSignal,
  lease: Lease,
): LeaseBoundPollSignal {
  if (parent.aborted) {
    return {
      signal: parent,
      refresh() {},
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

  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  const armDeadline = (next: Lease): void => {
    if (disposed || controller.signal.aborted) {
      return;
    }
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    const remainingMs = next.expiresAt.getTime() - Date.now();
    if (remainingMs <= 0) {
      controller.abort();
      return;
    }
    timer = setTimeout(() => {
      if (!controller.signal.aborted) {
        controller.abort();
      }
    }, remainingMs);
    // Avoid keeping the process alive solely for an in-flight poll deadline.
    if (typeof timer.unref === "function") {
      timer.unref();
    }
  };

  armDeadline(lease);

  return {
    signal: controller.signal,
    refresh(next: Lease) {
      armDeadline(next);
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
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
