/**
 * Managed-transport acquisition for the existing Runtime worker loop.
 *
 * @remarks Extends the one #336 worker with bounded polling supervision. No
 * second worker, queue, daemon, or mutable transport registry is introduced.
 * Accepted events enter the shared #337 envelope kernel; cursors advance only
 * after durable acceptance.
 *
 * @module
 */

import { isPollingTransport } from "../../signal/provider";
import type { RuntimeProgram } from "../program";
import { resolveProgramProvider } from "../program-providers";
import type { Lease } from "../ports/leases";
import type { RuntimeStoreAdapter } from "../store";
import { createRuntimeError } from "../engine/errors";
import { pollAndAccept, recordPollFailure } from "./worker-transport-poll";

const DEFAULT_BINDING_LEASE_MS = 30_000;

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
}

/**
 * Host-free supervised polling pass invoked once per worker tick.
 *
 * @remarks Holds binding leases across ticks while the worker runs. Shutdown
 * aborts in-flight polls and releases leases through {@link dispose}.
 */
export interface TransportSupervisionRunner {
  /**
   * Claim polling bindings, poll once each, accept envelopes, and checkpoint.
   *
   * @param signal - Abort when the worker is stopping.
   * @param now - Optional clock for interval and lease timestamps.
   */
  runOnce(
    signal: AbortSignal,
    now?: Date,
  ): Promise<TransportSupervisionRunResult>;
  /**
   * Abort acquisition, abandon in-flight polls, and release held binding leases.
   */
  dispose(): Promise<void>;
}

/**
 * Create managed-transport supervision for the worker maintenance loop, or
 * `undefined` when the program declares no polling transports.
 *
 * @param options - Program authority, store, and namespace.
 * @returns A host-free runner invoked once per worker tick, or `undefined`.
 * @throws When a declared binding cannot resolve to an executable provider.
 */
export function createWorkerTransportSupervision(
  options: CreateWorkerTransportSupervisionOptions,
): TransportSupervisionRunner | undefined {
  const pollingBindings = options.program.transports.filter((binding) => {
    const provider = resolveProgramProvider(options.program.providers, binding);
    if (!provider) {
      throw createRuntimeError({
        code: "CAPABILITY_MISSING",
        whatFailed: `Runtime worker cannot resolve provider for transport binding \`${binding.id}\`.`,
        why: "Managed-transport supervision requires program-declared provider authority.",
        whatStillWorks:
          "Queued Work maintenance still runs for executable targets in the same program.",
        nextStep: `Pass the matching signalProvider() in createRuntimeProgram({ providers }) for adapter \`${binding.adapter.id}\`.`,
      });
    }
    return isPollingTransport(provider.transport);
  });

  if (pollingBindings.length === 0) {
    return undefined;
  }

  if (!options.store.transports) {
    throw createRuntimeError({
      code: "CAPABILITY_MISSING",
      whatFailed:
        "Runtime worker cannot supervise managed transports without a store transports capability.",
      why: "Polling bindings require the optional Runtime store transports port before the worker starts.",
      whatStillWorks:
        "Queued Work maintenance still runs for executable targets when transports are omitted from the program.",
      nextStep:
        "Use a Runtime store that implements the transports port, or remove polling bindings from createRuntimeProgram({ transports }).",
    });
  }

  if (
    typeof options.store.transports.getBindingCheckpoint !== "function" ||
    typeof options.store.transports.putBindingCheckpoint !== "function"
  ) {
    throw createRuntimeError({
      code: "CAPABILITY_MISSING",
      whatFailed:
        "Runtime worker cannot supervise polling transports without binding checkpoint methods.",
      why: "Polling supervision resumes cursors through the transport store checkpoint port.",
      whatStillWorks:
        "Webhook envelope drain still runs when checkpoint methods are present or no polling bindings exist.",
      nextStep:
        "Use Memory or PostgreSQL Runtime storage that implements getBindingCheckpoint/putBindingCheckpoint.",
    });
  }

  const heldLeases = new Map<string, Lease>();
  let disposed = false;

  return Object.freeze({
    async runOnce(signal: AbortSignal, now: Date = new Date()) {
      if (disposed || signal.aborted) {
        return emptyResult(pollingBindings.length);
      }

      let leased = 0;
      let polled = 0;
      let accepted = 0;
      let duplicated = 0;
      let checkpointed = 0;
      let skipped = 0;
      let failed = 0;

      for (const binding of pollingBindings) {
        if (disposed || signal.aborted) {
          break;
        }

        const provider = resolveProgramProvider(
          options.program.providers,
          binding,
        );
        if (!provider || !isPollingTransport(provider.transport)) {
          skipped += 1;
          continue;
        }

        const transport = provider.transport;
        const resource = bindingLeaseResource(options.namespace, binding.id);
        let lease = heldLeases.get(binding.id) ?? null;

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

        const checkpoint =
          await options.store.transports!.getBindingCheckpoint!({
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

        try {
          const outcome = await pollAndAccept({
            store: options.store,
            namespace: options.namespace,
            binding,
            provider,
            transport,
            checkpoint,
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
        } catch {
          failed += 1;
          await recordPollFailure({
            store: options.store,
            namespace: options.namespace,
            bindingId: binding.id,
            checkpoint,
            now,
            ownerId: options.ownerId ?? lease.ownerId,
            code: "TRANSPORT_POLL_FAILED",
          });
        }
      }

      return Object.freeze({
        examined: pollingBindings.length,
        leased,
        polled,
        accepted,
        duplicated,
        checkpointed,
        skipped,
        failed,
      });
    },

    async dispose() {
      disposed = true;
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
  });
}
