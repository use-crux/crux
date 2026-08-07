/**
 * Process-local stream connection fibers owned by transport supervision.
 *
 * @remarks Fibers are not a second worker. They run inside the one Runtime
 * worker so long-lived `open`/iteration never blocks a bounded maintenance tick.
 *
 * @module
 */

import type { SignalProvider } from "../../signal/provider";
import type { StreamTransport } from "../../signal/transport";
import type { Lease } from "../ports/leases";
import type { RuntimeStoreAdapter } from "../store";
import type { RuntimeManagedTransportBinding } from "../transport/contracts";
import {
  createLeaseBoundPollSignal,
  type LeaseBoundPollSignal,
} from "./worker-transport-poll-signal";
import {
  runManagedStream,
  type RunManagedStreamResult,
  type StreamLeaseSlot,
} from "./worker-transport-stream";

/** Bound await for fiber cleanup during dispose (same order as worker stop). */
export const STREAM_FIBER_DISPOSE_TIMEOUT_MS = 10_000;

/** Process-local counters harvested from settled stream fibers. */
export interface StreamFiberCounters {
  accepted: number;
  duplicated: number;
  checkpointed: number;
  streamOpened: number;
  streamReconnected: number;
  streamFaulted: number;
}

/** One supervised stream fiber for a single binding. */
export interface StreamFiber {
  readonly bindingId: string;
  readonly abort: AbortController;
  readonly leaseSlot: StreamLeaseSlot;
  readonly leaseBound: LeaseBoundPollSignal;
  readonly unlinkParent: () => void;
  /** Settles when the managed stream fiber returns or throws. */
  task: Promise<void>;
  result: RunManagedStreamResult | null;
  error: unknown;
  settled: boolean;
}

/** Options for starting a managed stream fiber under supervision. */
export interface StartStreamFiberOptions {
  readonly store: RuntimeStoreAdapter;
  readonly namespace: string;
  readonly binding: RuntimeManagedTransportBinding;
  readonly provider: SignalProvider;
  readonly transport: StreamTransport;
  readonly lease: Lease;
  /** Worker-tick abort signal (stop / recovery abort). */
  readonly parentSignal: AbortSignal;
  readonly ownerId?: string;
}

/**
 * Start a tracked stream fiber without awaiting connection lifetime.
 *
 * @remarks Rejections are captured on the fiber handle so dispose/restart never
 * leaves an unhandled rejection. Callers must retain the handle until harvest
 * or dispose.
 */
export function startStreamFiber(
  options: StartStreamFiberOptions,
): StreamFiber {
  const abort = new AbortController();
  const unlinkParent = linkAbort(options.parentSignal, abort);
  const leaseSlot: StreamLeaseSlot = { current: options.lease };
  const leaseBound = createLeaseBoundPollSignal(abort.signal, options.lease);

  const fiber: StreamFiber = {
    bindingId: options.binding.id,
    abort,
    leaseSlot,
    leaseBound,
    unlinkParent,
    result: null,
    error: undefined,
    settled: false,
    task: Promise.resolve(),
  };

  fiber.task = runManagedStream({
    store: options.store,
    namespace: options.namespace,
    binding: options.binding,
    provider: options.provider,
    transport: options.transport,
    lease: options.lease,
    leaseSlot,
    leaseBound,
    signal: abort.signal,
    ownerId: options.ownerId,
  })
    .then((result) => {
      fiber.result = result;
      fiber.settled = true;
    })
    .catch((error: unknown) => {
      fiber.error = error;
      fiber.settled = true;
    })
    .finally(() => {
      // Drop parent linkage once the fiber settles; dispose is idempotent.
      unlinkParent();
    });

  // Ensure the Promise has a handler even if the caller never awaits task.
  void fiber.task;

  return fiber;
}

/**
 * Fold a settled fiber's outcome into runOnce counters.
 *
 * @returns Whether the binding lease should be dropped after harvest.
 */
export function harvestStreamFiber(
  fiber: StreamFiber,
  counters: StreamFiberCounters,
): { readonly leaseLost: boolean } {
  const result = fiber.result;
  if (!result) {
    // Unexpected throw: count as failure without claiming lease loss.
    if (fiber.error !== undefined) {
      counters.streamFaulted += 1;
    }
    return { leaseLost: false };
  }

  counters.accepted += result.accepted;
  counters.duplicated += result.duplicated;
  if (result.checkpointed) {
    counters.checkpointed += 1;
  }
  // The start path already counted the first open for this fiber.
  counters.streamOpened += Math.max(0, result.opens - 1);
  counters.streamReconnected += result.reconnects;
  if (
    result.outcome === "terminal" ||
    result.outcome === "exhausted" ||
    (result.failed && result.outcome !== "lease_lost")
  ) {
    counters.streamFaulted += 1;
  }

  return { leaseLost: result.leaseLost };
}

/**
 * Abort fibers, await bounded cleanup, and dispose lease-bound signals.
 *
 * @remarks Does not release binding leases — the supervision runner owns that.
 */
export async function disposeStreamFibers(
  fibers: Iterable<StreamFiber>,
  timeoutMs: number = STREAM_FIBER_DISPOSE_TIMEOUT_MS,
): Promise<void> {
  const list = [...fibers];
  for (const fiber of list) {
    if (!fiber.abort.signal.aborted) {
      fiber.abort.abort();
    }
  }

  await Promise.all(
    list.map(async (fiber) => {
      try {
        await settlesWithin(fiber.task, timeoutMs);
      } catch {
        // Best-effort; lease expiry remains the ownership fence.
      } finally {
        fiber.unlinkParent();
        fiber.leaseBound.dispose();
      }
    }),
  );
}

/** Refresh a running fiber's lease snapshot and deadline after store extend. */
export function refreshStreamFiberLease(
  fiber: StreamFiber,
  lease: Lease,
): void {
  fiber.leaseSlot.current = lease;
  fiber.leaseBound.refresh(lease);
}

function linkAbort(
  parent: AbortSignal,
  child: AbortController,
): () => void {
  if (parent.aborted) {
    if (!child.signal.aborted) {
      child.abort(parent.reason);
    }
    return () => {};
  }

  const onAbort = () => {
    if (!child.signal.aborted) {
      child.abort(parent.reason);
    }
  };
  parent.addEventListener("abort", onAbort);
  return () => {
    parent.removeEventListener("abort", onAbort);
  };
}

async function settlesWithin(
  work: Promise<void>,
  timeoutMs: number,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
    if (typeof timer.unref === "function") {
      timer.unref();
    }
  });
  const settled = await Promise.race([work.then(() => true), timeout]);
  if (timer !== undefined) {
    clearTimeout(timer);
  }
  return settled;
}
