/**
 * Managed-transport acquisition for the existing Runtime worker loop.
 *
 * @remarks Extends the one #336 worker with bounded polling supervision and
 * process-local stream connection fibers. No second worker, queue, daemon, or
 * mutable transport registry is introduced. Accepted events enter the shared
 * #337 envelope kernel; cursors advance only after durable acceptance.
 *
 * Stream fibers are started from a bounded {@link TransportSupervisionRunner.runOnce}
 * and never block the maintenance tick on long-lived `open`/iteration.
 *
 * @module
 */

import {
  isPollingTransport,
  isStreamTransport,
  type SignalProvider,
} from "../../signal/provider";
import type { StreamTransport } from "../../signal/transport";
import type { RuntimeProgram } from "../program";
import { resolveProgramProvider } from "../program-providers";
import type { Lease } from "../ports/leases";
import type { RuntimeStoreAdapter } from "../store";
import type { RuntimeManagedTransportBinding } from "../transport/contracts";
import type { RuntimeTransportBindingCheckpoint } from "../transport/binding-checkpoint";
import { createRuntimeError } from "../engine/errors";
import { pollAndAccept, recordPollFailure } from "./worker-transport-poll";
import {
  MAX_STREAM_TRANSIENT_FAILURES,
  TRANSPORT_STREAM_EXHAUSTED,
} from "./worker-transport-stream";
import {
  loadBindingCheckpoint,
  writeStreamCheckpoint,
} from "./worker-transport-stream-connection";
import { resolveStreamCheckpoint } from "./worker-transport-stream-resolve";
import {
  disposeStreamFibers,
  harvestStreamFiber,
  refreshStreamFiberLease,
  startStreamFiber,
  type StreamFiber,
  type StreamFiberCounters,
} from "./worker-transport-supervision-stream";

const DEFAULT_BINDING_LEASE_MS = 30_000;

/** Shared catch code when a stream binding throws outside a managed fiber. */
const TRANSPORT_STREAM_FAILED = "TRANSPORT_STREAM_FAILED" as const;

/** Shared catch code when a polling binding throws outside pollAndAccept. */
const TRANSPORT_POLL_FAILED = "TRANSPORT_POLL_FAILED" as const;

/** Options for building the worker-owned transport supervision loop. */
export interface CreateWorkerTransportSupervisionOptions {
  /** Immutable program providing executable providers and inert bindings. */
  readonly program: RuntimeProgram;
  /** Runtime store that owns leases and the transport port. */
  readonly store: RuntimeStoreAdapter;
  /** Runtime namespace that owns binding identity. */
  readonly namespace: string;
  /** Optional owner id recorded on leases and checkpoints. */
  readonly ownerId?: string;
}

/** Bounded counters for one supervision pass. */
export interface TransportSupervisionRunResult {
  readonly examined: number;
  readonly leased: number;
  readonly polled: number;
  readonly accepted: number;
  readonly duplicated: number;
  readonly checkpointed: number;
  readonly skipped: number;
  readonly failed: number;
  /** Stream connection opens observed this pass (starts + harvested opens). */
  readonly streamOpened: number;
  /** Stream reconnect waits harvested from settled fibers this pass. */
  readonly streamReconnected: number;
  /** Stream fibers that ended terminal/exhausted this pass. */
  readonly streamFaulted: number;
}

/**
 * Host-free supervised transport pass invoked once per worker tick.
 *
 * @remarks Holds binding leases across ticks while the worker runs. Stream
 * fibers continue between ticks. Shutdown aborts in-flight polls and stream
 * fibers, then releases leases through {@link dispose}.
 */
export interface TransportSupervisionRunner {
  /**
   * Claim polling/stream bindings, poll once each, start/refresh stream fibers,
   * accept envelopes, and checkpoint.
   *
   * @param signal - Abort when the worker is stopping.
   * @param now - Optional clock for interval and lease timestamps.
   */
  runOnce(
    signal: AbortSignal,
    now?: Date,
  ): Promise<TransportSupervisionRunResult>;
  /**
   * Abort acquisition, abandon in-flight polls/fibers, and release held leases.
   */
  dispose(): Promise<void>;
}

/**
 * Create managed-transport supervision for the worker maintenance loop, or
 * `undefined` when the program declares no polling or stream transports.
 *
 * @param options - Program authority, store, and namespace.
 * @returns A host-free runner invoked once per worker tick, or `undefined`.
 * @throws When a declared binding cannot resolve to an executable provider.
 */
export function createWorkerTransportSupervision(
  options: CreateWorkerTransportSupervisionOptions,
): TransportSupervisionRunner | undefined {
  // Webhook (and other non-polling/non-stream) bindings do not need in-process
  // supervision. Bindings that resolve to a polling or stream provider are
  // supervised; a polling/stream binding whose provider is absent is still
  // rejected at createRuntimeProgram() as CAPABILITY_MISSING.
  const supervisedBindings = options.program.transports.filter((binding) => {
    const provider = resolveProgramProvider(options.program.providers, binding);
    if (!provider) {
      return false;
    }
    return (
      isPollingTransport(provider.transport) ||
      isStreamTransport(provider.transport)
    );
  });

  if (supervisedBindings.length === 0) {
    return undefined;
  }

  if (!options.store.transports) {
    throw createRuntimeError({
      code: "CAPABILITY_MISSING",
      whatFailed:
        "Runtime worker cannot supervise managed transports without a store transports capability.",
      why: "Polling and stream bindings require the optional Runtime store transports port before the worker starts.",
      whatStillWorks:
        "Queued Work maintenance still runs for executable targets when transports are omitted from the program.",
      nextStep:
        "Use a Runtime store that implements the transports port, or remove polling/stream bindings from createRuntimeProgram({ transports }).",
    });
  }

  if (
    typeof options.store.transports.getBindingCheckpoint !== "function" ||
    typeof options.store.transports.putBindingCheckpoint !== "function"
  ) {
    throw createRuntimeError({
      code: "CAPABILITY_MISSING",
      whatFailed:
        "Runtime worker cannot supervise managed transports without binding checkpoint methods.",
      why: "Polling and stream supervision resume cursors through the transport store checkpoint port.",
      whatStillWorks:
        "Webhook envelope drain still runs when checkpoint methods are present or no polling/stream bindings exist.",
      nextStep:
        "Use Memory or PostgreSQL Runtime storage that implements getBindingCheckpoint/putBindingCheckpoint.",
    });
  }

  const heldLeases = new Map<string, Lease>();
  const streamFibers = new Map<string, StreamFiber>();
  /** Consecutive top-level rejected stream fibers per binding (outside reconnect). */
  const streamFiberFailures = new Map<string, number>();
  let disposed = false;

  return Object.freeze({
    async runOnce(signal: AbortSignal, now: Date = new Date()) {
      if (disposed || signal.aborted) {
        return emptyResult(supervisedBindings.length);
      }

      let leased = 0;
      let polled = 0;
      let accepted = 0;
      let duplicated = 0;
      let checkpointed = 0;
      let skipped = 0;
      let failed = 0;
      const streamCounters: StreamFiberCounters = {
        accepted: 0,
        duplicated: 0,
        checkpointed: 0,
        streamOpened: 0,
        streamReconnected: 0,
        streamFaulted: 0,
      };

      for (const binding of supervisedBindings) {
        if (disposed || signal.aborted) {
          break;
        }

        // Isolate claim / checkpoint-read / poll / fiber errors so one binding
        // cannot abort the rest of the supervision cycle.
        let lease = heldLeases.get(binding.id) ?? null;
        let checkpoint: RuntimeTransportBindingCheckpoint | null = null;
        let streamBinding = false;

        try {
          const provider = resolveProgramProvider(
            options.program.providers,
            binding,
          );
          if (!provider) {
            skipped += 1;
            continue;
          }

          if (isStreamTransport(provider.transport)) {
            streamBinding = true;
            const streamOutcome = await superviseStreamBinding({
              options,
              binding,
              provider,
              transport: provider.transport,
              signal,
              now,
              heldLeases,
              streamFibers,
              streamFiberFailures,
              lease,
              streamCounters,
            });
            lease = streamOutcome.lease;
            leased += streamOutcome.leased;
            skipped += streamOutcome.skipped;
            failed += streamOutcome.failed;
            continue;
          }

          if (!isPollingTransport(provider.transport)) {
            skipped += 1;
            continue;
          }

          const transport = provider.transport;
          const resource = bindingLeaseResource(options.namespace, binding.id);

          if (lease) {
            try {
              lease = await options.store.leases.extend(
                lease,
                DEFAULT_BINDING_LEASE_MS,
              );
              heldLeases.set(binding.id, lease);
            } catch {
              heldLeases.delete(binding.id);
              lease = null;
            }
          }

          if (!lease) {
            lease = await options.store.leases.claim(resource, {
              ttlMs: DEFAULT_BINDING_LEASE_MS,
              ...(options.ownerId ? { ownerId: options.ownerId } : {}),
            });
            if (!lease) {
              skipped += 1;
              continue;
            }
            heldLeases.set(binding.id, lease);
          }

          leased += 1;

          checkpoint = await options.store.transports!.getBindingCheckpoint!({
            namespace: options.namespace,
            bindingId: binding.id,
          });

          if (
            transport.intervalMs !== undefined &&
            checkpoint?.lastPolledAt !== undefined &&
            checkpoint.morePending !== true
          ) {
            const lastPolledMs = Date.parse(checkpoint.lastPolledAt);
            if (
              Number.isFinite(lastPolledMs) &&
              now.getTime() < lastPolledMs + transport.intervalMs
            ) {
              skipped += 1;
              continue;
            }
          }

          const outcome = await pollAndAccept({
            store: options.store,
            namespace: options.namespace,
            binding,
            provider,
            transport,
            checkpoint,
            lease,
            signal,
            now,
            ownerId: options.ownerId ?? lease.ownerId,
          });
          polled += 1;
          accepted += outcome.accepted;
          duplicated += outcome.duplicated;
          if (outcome.checkpointed) {
            checkpointed += 1;
          }
          if (outcome.failed) {
            failed += 1;
          }
          if (outcome.leaseLost) {
            heldLeases.delete(binding.id);
          }
        } catch {
          failed += 1;
          if (lease) {
            try {
              const failure = await recordPollFailure({
                store: options.store,
                namespace: options.namespace,
                bindingId: binding.id,
                checkpoint,
                lease,
                now,
                ownerId: options.ownerId ?? lease.ownerId,
                code: streamBinding
                  ? TRANSPORT_STREAM_FAILED
                  : TRANSPORT_POLL_FAILED,
              });
              if (failure.leaseLost) {
                heldLeases.delete(binding.id);
              }
            } catch {
              // Failure recording must not prevent later bindings.
            }
          }
        }
      }

      return Object.freeze({
        examined: supervisedBindings.length,
        leased,
        polled,
        accepted: accepted + streamCounters.accepted,
        duplicated: duplicated + streamCounters.duplicated,
        checkpointed: checkpointed + streamCounters.checkpointed,
        skipped,
        failed: failed + streamCounters.streamFaulted,
        streamOpened: streamCounters.streamOpened,
        streamReconnected: streamCounters.streamReconnected,
        streamFaulted: streamCounters.streamFaulted,
      });
    },

    async dispose() {
      disposed = true;
      const fibers = [...streamFibers.values()];
      streamFibers.clear();
      await disposeStreamFibers(fibers);

      const leases = [...heldLeases.values()];
      heldLeases.clear();
      await Promise.all(
        leases.map(async (lease) => {
          try {
            await options.store.leases.release(lease);
          } catch {
            // Best-effort release; lease expiry remains the fence.
          }
        }),
      );
    },
  });
}

/** Lease resource identity for one supervised binding. */
export function bindingLeaseResource(
  namespace: string,
  bindingId: string,
): string {
  return `transport-binding:${namespace}:${bindingId}`;
}

async function superviseStreamBinding(args: {
  readonly options: CreateWorkerTransportSupervisionOptions;
  readonly binding: RuntimeManagedTransportBinding;
  readonly provider: SignalProvider;
  readonly transport: StreamTransport;
  readonly signal: AbortSignal;
  readonly now: Date;
  readonly heldLeases: Map<string, Lease>;
  readonly streamFibers: Map<string, StreamFiber>;
  readonly streamFiberFailures: Map<string, number>;
  lease: Lease | null;
  readonly streamCounters: StreamFiberCounters;
}): Promise<{
  readonly lease: Lease | null;
  readonly leased: number;
  readonly skipped: number;
  readonly failed: number;
}> {
  const {
    options,
    binding,
    provider,
    transport,
    signal,
    now,
    heldLeases,
    streamFibers,
    streamFiberFailures,
    streamCounters,
  } = args;
  let { lease } = args;
  let leased = 0;
  let skipped = 0;
  let failed = 0;

  // Harvest a settled fiber before deciding whether to reopen.
  const existing = streamFibers.get(binding.id);
  if (existing?.settled) {
    const harvest = harvestStreamFiber(existing, streamCounters);
    streamFibers.delete(binding.id);
    existing.leaseBound.dispose();
    existing.unlinkParent();

    if (harvest.leaseLost) {
      heldLeases.delete(binding.id);
      lease = null;
    }

    if (existing.error !== undefined) {
      const failures = (streamFiberFailures.get(binding.id) ?? 0) + 1;
      streamFiberFailures.set(binding.id, failures);

      if (failures >= MAX_STREAM_TRANSIENT_FAILURES) {
        // harvest already counted streamFaulted for this rejection.
        await faultStreamBindingExhausted({
          options,
          binding,
          lease,
          heldLeases,
          now,
        });
        // Stop reopening after the bound, even when the fault write fails.
        return { lease: null, leased, skipped, failed: 0 };
      }
    } else {
      // Successful managed-stream harvest (result present): reset the counter.
      streamFiberFailures.delete(binding.id);
    }
  }

  const running = streamFibers.get(binding.id);
  if (running && !running.settled) {
    // Extend the held lease and refresh the fiber deadline; do not start a
    // second connection for the same binding.
    if (lease) {
      try {
        lease = await options.store.leases.extend(
          lease,
          DEFAULT_BINDING_LEASE_MS,
        );
        heldLeases.set(binding.id, lease);
        refreshStreamFiberLease(running, lease);
        leased = 1;
      } catch {
        heldLeases.delete(binding.id);
        lease = null;
        if (!running.abort.signal.aborted) {
          running.abort.abort();
        }
        failed = 1;
      }
    } else {
      // Fiber is running without a held lease map entry — abort defensively.
      if (!running.abort.signal.aborted) {
        running.abort.abort();
      }
      skipped = 1;
    }
    return { lease, leased, skipped, failed };
  }

  // Unfenced checkpoint read: skip claim when durable status is non-active
  // under the live config identity (design: do not block operators with a lease).
  const checkpoint = await options.store.transports!.getBindingCheckpoint!({
    namespace: options.namespace,
    bindingId: binding.id,
  });
  const resolved = resolveStreamCheckpoint(checkpoint, binding.configRef);
  if (resolved.skipOpen) {
    streamFiberFailures.delete(binding.id);
    skipped = 1;
    return { lease, leased, skipped, failed };
  }

  // Bound reached earlier and durable fault did not land — do not reopen.
  if (
    (streamFiberFailures.get(binding.id) ?? 0) >= MAX_STREAM_TRANSIENT_FAILURES
  ) {
    failed = 1;
    if (lease) {
      await releaseBindingLease(options, heldLeases, binding.id, lease);
      lease = null;
    }
    return { lease, leased, skipped, failed };
  }

  const resource = bindingLeaseResource(options.namespace, binding.id);

  if (lease) {
    try {
      lease = await options.store.leases.extend(lease, DEFAULT_BINDING_LEASE_MS);
      heldLeases.set(binding.id, lease);
    } catch {
      heldLeases.delete(binding.id);
      lease = null;
    }
  }

  if (!lease) {
    lease = await options.store.leases.claim(resource, {
      ttlMs: DEFAULT_BINDING_LEASE_MS,
      ...(options.ownerId ? { ownerId: options.ownerId } : {}),
    });
    if (!lease) {
      skipped = 1;
      return { lease, leased, skipped, failed };
    }
    heldLeases.set(binding.id, lease);
  }

  leased = 1;

  // Start a new fiber without awaiting connection lifetime.
  const fiber = startStreamFiber({
    store: options.store,
    namespace: options.namespace,
    binding,
    provider,
    transport,
    lease,
    parentSignal: signal,
    ownerId: options.ownerId ?? lease.ownerId,
  });
  streamFibers.set(binding.id, fiber);
  // Count the start as one open attempt; harvested opens add further opens.
  streamCounters.streamOpened += 1;

  return { lease, leased, skipped, failed };
}

async function faultStreamBindingExhausted(args: {
  readonly options: CreateWorkerTransportSupervisionOptions;
  readonly binding: RuntimeManagedTransportBinding;
  lease: Lease | null;
  readonly heldLeases: Map<string, Lease>;
  readonly now: Date;
}): Promise<void> {
  const { options, binding, heldLeases, now } = args;
  let { lease } = args;

  if (!lease) {
    return;
  }

  try {
    const previous = await loadBindingCheckpoint(
      options.store,
      options.namespace,
      binding.id,
    );
    const written = await writeStreamCheckpoint({
      store: options.store,
      namespace: options.namespace,
      bindingId: binding.id,
      cursor: previous?.cursor ?? null,
      lease,
      now,
      ownerId: options.ownerId ?? lease.ownerId,
      configRef: binding.configRef,
      status: "faulted",
      lastErrorCode: TRANSPORT_STREAM_EXHAUSTED,
      previous,
    });
    if (written.kind === "rejected") {
      heldLeases.delete(binding.id);
      lease = null;
    }
  } catch {
    // Fault writes must remain bounded and never surface as unhandled rejections.
  }

  if (lease) {
    await releaseBindingLease(options, heldLeases, binding.id, lease);
  }
}

async function releaseBindingLease(
  options: CreateWorkerTransportSupervisionOptions,
  heldLeases: Map<string, Lease>,
  bindingId: string,
  lease: Lease,
): Promise<void> {
  heldLeases.delete(bindingId);
  try {
    await options.store.leases.release(lease);
  } catch {
    // Lease expiry remains the ownership fence.
  }
}

function emptyResult(examined: number): TransportSupervisionRunResult {
  return Object.freeze({
    examined,
    leased: 0,
    polled: 0,
    accepted: 0,
    duplicated: 0,
    checkpointed: 0,
    skipped: examined,
    failed: 0,
    streamOpened: 0,
    streamReconnected: 0,
    streamFaulted: 0,
  });
}
