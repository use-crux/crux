/**
 * Managed stream reconnect fiber: open, consume, backoff, fault.
 *
 * @remarks Connection accept/checkpoint mechanics live in
 * {@link ./worker-transport-stream-connection}. This module owns the
 * process-local reconnect loop and bounded exhaustion.
 *
 * @module
 */

import type { SignalProvider } from "../../signal/provider";
import type { StreamTransport } from "../../signal/transport";
import { retryDelayMs } from "../engine/retry";
import type { Lease } from "../ports/leases";
import type { RuntimeStoreAdapter } from "../store";
import type { RuntimeManagedTransportBinding } from "../transport/contracts";
import {
  createLeaseBoundPollSignal,
  isLeaseExpired,
  type LeaseBoundPollSignal,
} from "./worker-transport-poll-signal";
import {
  loadBindingCheckpoint,
  runStreamConnection,
  writeStreamCheckpoint,
  type StreamLeaseSlot,
} from "./worker-transport-stream-connection";
import { resolveStreamCheckpoint } from "./worker-transport-stream-resolve";

export type {
  RunStreamConnectionOptions,
  RunStreamConnectionResult,
  StreamConnectionOutcome,
  StreamLeaseSlot,
} from "./worker-transport-stream-connection";
export { runStreamConnection } from "./worker-transport-stream-connection";
export {
  resolveStreamCheckpoint,
  type ResolvedStreamCheckpoint,
} from "./worker-transport-stream-resolve";

/** Default base delay for stream reconnect full-jitter backoff. */
export const DEFAULT_STREAM_BASE_BACKOFF_MS = 1_000;

/** Maximum delay for stream reconnect full-jitter backoff. */
export const DEFAULT_STREAM_MAX_BACKOFF_MS = 60_000;

/**
 * Consecutive transient connection failures before durable stream exhaustion.
 *
 * @remarks Process-local only. Restart resets the counter; durable `faulted`
 * status prevents silent resume after exhaustion.
 */
export const MAX_STREAM_TRANSIENT_FAILURES = 32;

/** Durable lastErrorCode written when transient reconnects are exhausted. */
export const TRANSPORT_STREAM_EXHAUSTED =
  "TRANSPORT_STREAM_EXHAUSTED" as const;

/**
 * Injectable clock for long-running stream reconnect loops.
 *
 * @remarks Internal/test surface only — not part of provider authoring.
 */
export interface ManagedStreamClock {
  /** Current wall clock used for checkpoint timestamps. */
  now(): Date;
  /**
   * Sleep for `ms` while honoring cooperative cancellation.
   *
   * @remarks Implementations must reject or resolve promptly when `signal`
   * aborts so reconnect waits stay cancellable.
   */
  delay(ms: number, signal: AbortSignal): Promise<void>;
}

/** Options for the managed reconnecting stream fiber. */
export interface RunManagedStreamOptions {
  readonly store: RuntimeStoreAdapter;
  readonly namespace: string;
  readonly binding: RuntimeManagedTransportBinding;
  readonly provider: SignalProvider;
  readonly transport: StreamTransport;
  /** Active binding lease that fences durable checkpoint writes. */
  readonly lease: Lease;
  /**
   * Optional mutable lease view updated by supervision on extend.
   *
   * @remarks When omitted, a private slot is created from {@link lease}.
   */
  readonly leaseSlot?: StreamLeaseSlot;
  /**
   * Optional pre-built lease-bound signal owned by supervision.
   *
   * @remarks When set, the fiber reuses the signal and does not dispose it.
   * Supervision refreshes the deadline after each lease extend.
   */
  readonly leaseBound?: LeaseBoundPollSignal;
  readonly signal: AbortSignal;
  /**
   * Fallback clock instant when {@link clock} is omitted.
   *
   * @remarks Prefer {@link clock}.now for multi-connection fibers.
   */
  readonly now?: Date;
  readonly ownerId?: string;
  /**
   * Process-local clock and delay injection for deterministic tests.
   *
   * @remarks When omitted, uses `new Date()` and a signal-aware `setTimeout`.
   */
  readonly clock?: ManagedStreamClock;
  /** Deterministic jitter source for reconnect backoff. Defaults to `Math.random`. */
  readonly rng?: () => number;
  /**
   * Override consecutive transient failure bound.
   *
   * @remarks Defaults to {@link MAX_STREAM_TRANSIENT_FAILURES}. Tests may lower
   * this for exhaustion coverage without spinning 32 opens.
   */
  readonly maxTransientFailures?: number;
  /** Override base reconnect delay. Defaults to {@link DEFAULT_STREAM_BASE_BACKOFF_MS}. */
  readonly baseBackoffMs?: number;
  /** Override max reconnect delay. Defaults to {@link DEFAULT_STREAM_MAX_BACKOFF_MS}. */
  readonly maxBackoffMs?: number;
}

/** How the managed reconnecting fiber stopped. */
export type ManagedStreamOutcome =
  | "aborted"
  | "terminal"
  | "exhausted"
  | "lease_lost"
  | "skipped";

/** Aggregated outcome of a managed reconnecting stream fiber. */
export interface RunManagedStreamResult {
  readonly accepted: number;
  readonly duplicated: number;
  readonly checkpointed: boolean;
  readonly failed: boolean;
  readonly leaseLost: boolean;
  readonly outcome: ManagedStreamOutcome;
  readonly lastErrorCode?: string;
  /** Number of `open` attempts performed. */
  readonly opens: number;
  /** Number of reconnect waits entered after EOF or transient failure. */
  readonly reconnects: number;
}

/**
 * Run a long-lived stream fiber: open, consume, reconnect on EOF/transient,
 * and durable-fault on terminal error or bounded exhaustion.
 *
 * @remarks Reopens always from the durable checkpoint cursor (not process-local
 * uncheckpointed progress). Abort and lease loss do not count as failures,
 * do not reconnect, and do not accept/checkpoint after the fence trips.
 * Backoff attempt state is process-local only.
 */
export async function runManagedStream(
  options: RunManagedStreamOptions,
): Promise<RunManagedStreamResult> {
  const clock = options.clock ?? createDefaultStreamClock();
  const rng = options.rng ?? Math.random;
  const maxTransientFailures =
    options.maxTransientFailures ?? MAX_STREAM_TRANSIENT_FAILURES;
  const baseBackoffMs =
    options.baseBackoffMs ?? DEFAULT_STREAM_BASE_BACKOFF_MS;
  const maxBackoffMs = options.maxBackoffMs ?? DEFAULT_STREAM_MAX_BACKOFF_MS;
  const leaseSlot: StreamLeaseSlot = options.leaseSlot ?? {
    current: options.lease,
  };
  const ownsLeaseBound = options.leaseBound === undefined;
  const leaseBound =
    options.leaseBound ??
    createLeaseBoundPollSignal(options.signal, leaseSlot.current);
  const fiberSignal = leaseBound.signal;

  let accepted = 0;
  let duplicated = 0;
  let checkpointed = false;
  let opens = 0;
  let reconnects = 0;
  let consecutiveFailures = 0;
  let backoffAttempt = 0;
  let lastErrorCode: string | undefined;

  try {
    while (!fiberSignal.aborted && !isLeaseExpired(leaseSlot.current)) {
      leaseBound.refresh(leaseSlot.current);

      const checkpoint = await loadBindingCheckpoint(
        options.store,
        options.namespace,
        options.binding.id,
      );
      const resolved = resolveStreamCheckpoint(
        checkpoint,
        options.binding.configRef,
      );

      // Durable faulted/disabled under the live config identity: do not open.
      // Checkpoint get is unfenced, so supervision may make this skip decision
      // before claiming a binding lease (no write on the skip path).
      if (resolved.skipOpen) {
        return {
          accepted,
          duplicated,
          checkpointed,
          failed: resolved.status === "faulted",
          leaseLost: false,
          outcome:
            resolved.status === "faulted"
              ? lastErrorCode === TRANSPORT_STREAM_EXHAUSTED ||
                checkpoint?.lastErrorCode === TRANSPORT_STREAM_EXHAUSTED
                ? "exhausted"
                : "terminal"
              : "skipped",
          lastErrorCode:
            lastErrorCode ?? checkpoint?.lastErrorCode ?? undefined,
          opens,
          reconnects,
        };
      }

      const now = clock.now();
      opens += 1;

      const connection = await runStreamConnection({
        store: options.store,
        namespace: options.namespace,
        binding: options.binding,
        provider: options.provider,
        transport: options.transport,
        checkpoint,
        // Effective cursor after config over-invalidation (may be null).
        cursor: resolved.cursor,
        lease: leaseSlot.current,
        leaseSlot,
        leaseBound,
        signal: options.signal,
        now,
        ownerId: options.ownerId,
      });

      accepted += connection.accepted;
      duplicated += connection.duplicated;
      if (connection.checkpointed) {
        checkpointed = true;
      }
      if (connection.lastErrorCode !== undefined) {
        lastErrorCode = connection.lastErrorCode;
      }

      if (connection.outcome === "aborted") {
        return {
          accepted,
          duplicated,
          checkpointed,
          failed: false,
          leaseLost: false,
          outcome: "aborted",
          lastErrorCode,
          opens,
          reconnects,
        };
      }

      if (connection.outcome === "lease_lost") {
        return {
          accepted,
          duplicated,
          checkpointed,
          failed: true,
          leaseLost: true,
          outcome: "lease_lost",
          lastErrorCode,
          opens,
          reconnects,
        };
      }

      if (connection.outcome === "terminal") {
        return {
          accepted,
          duplicated,
          checkpointed,
          failed: true,
          leaseLost: false,
          outcome: "terminal",
          lastErrorCode: connection.lastErrorCode ?? lastErrorCode,
          opens,
          reconnects,
        };
      }

      const madeProgress =
        connection.accepted > 0 ||
        connection.duplicated > 0 ||
        connection.checkpointed;

      if (madeProgress) {
        consecutiveFailures = 0;
        backoffAttempt = 0;
      }

      if (
        connection.outcome === "transient" ||
        connection.outcome === "contract_invalid"
      ) {
        consecutiveFailures += 1;
        if (consecutiveFailures >= maxTransientFailures) {
          const previous = await loadBindingCheckpoint(
            options.store,
            options.namespace,
            options.binding.id,
          );
          const written = await writeStreamCheckpoint({
            store: options.store,
            namespace: options.namespace,
            bindingId: options.binding.id,
            cursor: previous?.cursor ?? null,
            lease: leaseSlot.current,
            now: clock.now(),
            ownerId: options.ownerId,
            configRef: options.binding.configRef,
            status: "faulted",
            lastErrorCode: TRANSPORT_STREAM_EXHAUSTED,
            previous,
          });

          return {
            accepted,
            duplicated,
            checkpointed,
            failed: true,
            leaseLost: written.kind === "rejected",
            outcome: written.kind === "rejected" ? "lease_lost" : "exhausted",
            lastErrorCode: TRANSPORT_STREAM_EXHAUSTED,
            opens,
            reconnects,
          };
        }
      }

      if (fiberSignal.aborted || isLeaseExpired(leaseSlot.current)) {
        return {
          accepted,
          duplicated,
          checkpointed,
          failed: false,
          leaseLost: isLeaseExpired(leaseSlot.current),
          outcome: isLeaseExpired(leaseSlot.current) ? "lease_lost" : "aborted",
          lastErrorCode,
          opens,
          reconnects,
        };
      }

      // Clean EOF and transient/contract failures reconnect with backoff.
      backoffAttempt += 1;
      const delayMs = retryDelayMs({
        attempt: backoffAttempt,
        rng,
        baseDelayMs: baseBackoffMs,
        maxDelayMs: maxBackoffMs,
      });
      reconnects += 1;

      try {
        await clock.delay(delayMs, fiberSignal);
      } catch {
        // Delay implementations may reject on abort; treat as cooperative stop.
      }

      if (fiberSignal.aborted || isLeaseExpired(leaseSlot.current)) {
        return {
          accepted,
          duplicated,
          checkpointed,
          failed: false,
          leaseLost: isLeaseExpired(leaseSlot.current),
          outcome: isLeaseExpired(leaseSlot.current) ? "lease_lost" : "aborted",
          lastErrorCode,
          opens,
          reconnects,
        };
      }
    }

    return {
      accepted,
      duplicated,
      checkpointed,
      failed: false,
      leaseLost: isLeaseExpired(leaseSlot.current),
      outcome: isLeaseExpired(leaseSlot.current) ? "lease_lost" : "aborted",
      lastErrorCode,
      opens,
      reconnects,
    };
  } finally {
    if (ownsLeaseBound) {
      leaseBound.dispose();
    }
  }
}

function createDefaultStreamClock(): ManagedStreamClock {
  return {
    now: () => new Date(),
    delay: (ms, signal) => delayWithSignal(ms, signal),
  };
}

function delayWithSignal(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    if (typeof timer.unref === "function") {
      timer.unref();
    }

    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
