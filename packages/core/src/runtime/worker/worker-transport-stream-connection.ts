/**
 * Single leased stream connection: open, pull, accept, checkpoint.
 *
 * @remarks Consumes items serially under pull backpressure. Cursors that cover
 * an envelope are written only after durable acceptance through the shared
 * #337 kernel. Reuses the lease-bound AbortSignal helper from polling.
 *
 * @module
 */

import type { SignalProvider } from "../../signal/provider";
import type {
  StreamEnvelopeItem,
  StreamItem,
  StreamTransport,
} from "../../signal/transport";
import type { Lease } from "../ports/leases";
import type { RuntimeStoreAdapter } from "../store";
import { acceptTransportEnvelope } from "../transport/accept";
import type {
  RuntimeTransportBindingCheckpoint,
  RuntimeTransportBindingStatus,
} from "../transport/binding-checkpoint";
import type {
  RuntimeAcceptedTransportEnvelope,
  RuntimeManagedTransportBinding,
  RuntimeTransportConfigRef,
} from "../transport/contracts";
import { TransportEnvelopeConflictError } from "../transport/lifecycle-errors";
import {
  isManagedStreamTerminalError,
  isSafeProviderErrorCode,
  managedStreamTerminalErrorCode,
} from "../transport/stream-errors";
import {
  TRANSPORT_STREAM_CONTRACT_INVALID,
  validateStreamItem,
} from "../transport/stream-item";
import {
  createLeaseBoundPollSignal,
  isLeaseExpired,
} from "./worker-transport-poll-signal";

/**
 * How a single stream connection finished.
 *
 * @remarks Reconnect loops interpret `"eof"`, `"transient"`, and
 * `"contract_invalid"` as reconnect candidates; `"terminal"` becomes durable
 * faulted; `"aborted"` stops without failure.
 */
export type StreamConnectionOutcome =
  | "eof"
  | "terminal"
  | "transient"
  | "contract_invalid"
  | "aborted"
  | "lease_lost";

/** Options for one leased stream connection attempt. */
export interface RunStreamConnectionOptions {
  readonly store: RuntimeStoreAdapter;
  readonly namespace: string;
  readonly binding: RuntimeManagedTransportBinding;
  readonly provider: SignalProvider;
  readonly transport: StreamTransport;
  /**
   * Durable checkpoint observed before open.
   *
   * @remarks Used as the baseline for cursor retention on failures. Open
   * receives {@link cursor} when provided, otherwise `checkpoint?.cursor`.
   */
  readonly checkpoint: RuntimeTransportBindingCheckpoint | null;
  /**
   * Effective open cursor after config resolution.
   *
   * @remarks When omitted, falls back to `checkpoint?.cursor ?? null`.
   */
  readonly cursor?: string | null;
  /** Active binding lease that fences durable checkpoint writes. */
  readonly lease: Lease;
  readonly signal: AbortSignal;
  readonly now: Date;
  readonly ownerId?: string;
}

/** Bounded outcome of one stream connection attempt. */
export interface RunStreamConnectionResult {
  readonly accepted: number;
  readonly duplicated: number;
  /** True when at least one successful cursor checkpoint was written. */
  readonly checkpointed: boolean;
  readonly failed: boolean;
  readonly leaseLost: boolean;
  readonly outcome: StreamConnectionOutcome;
  readonly lastErrorCode?: string;
}

/**
 * Open one stream connection, pull items serially, accept envelopes, and
 * lease-fence checkpoint writes only after durable acceptance.
 *
 * @remarks Does not reconnect. Callers own EOF/transient reconnect loops.
 * Honors the parent signal and the lease-bound deadline derived from the
 * active binding lease.
 */
export async function runStreamConnection(
  options: RunStreamConnectionOptions,
): Promise<RunStreamConnectionResult> {
  const streamControl = createLeaseBoundPollSignal(
    options.signal,
    options.lease,
  );

  let accepted = 0;
  let duplicated = 0;
  let checkpointed = false;
  let latestCheckpoint = options.checkpoint;

  try {
    if (streamControl.signal.aborted || isLeaseExpired(options.lease)) {
      return abortedOutcome(options.lease, accepted, duplicated, checkpointed);
    }

    const openCursor =
      options.cursor !== undefined
        ? options.cursor
        : (options.checkpoint?.cursor ?? null);

    let iterable: AsyncIterable<StreamItem>;
    try {
      iterable = await options.transport.open({
        cursor: openCursor,
        signal: streamControl.signal,
        configRef: options.binding.configRef,
      });
    } catch (error) {
      return await handleConnectionError({
        error,
        options,
        latestCheckpoint,
        accepted,
        duplicated,
        checkpointed,
        signal: streamControl.signal,
      });
    }

    if (streamControl.signal.aborted || isLeaseExpired(options.lease)) {
      await bestEffortReturn(iterable);
      return abortedOutcome(options.lease, accepted, duplicated, checkpointed);
    }

    const iterator = iterable[Symbol.asyncIterator]();

    try {
      for (;;) {
        if (streamControl.signal.aborted || isLeaseExpired(options.lease)) {
          await bestEffortIteratorReturn(iterator);
          return abortedOutcome(
            options.lease,
            accepted,
            duplicated,
            checkpointed,
          );
        }

        let next: IteratorResult<StreamItem>;
        try {
          next = await iterator.next();
        } catch (error) {
          return await handleConnectionError({
            error,
            options,
            latestCheckpoint,
            accepted,
            duplicated,
            checkpointed,
            signal: streamControl.signal,
          });
        }

        if (next.done) {
          return {
            accepted,
            duplicated,
            checkpointed,
            failed: false,
            leaseLost: false,
            outcome: "eof",
          };
        }

        if (streamControl.signal.aborted || isLeaseExpired(options.lease)) {
          await bestEffortIteratorReturn(iterator);
          return abortedOutcome(
            options.lease,
            accepted,
            duplicated,
            checkpointed,
          );
        }

        let item: StreamItem;
        try {
          item = validateStreamItem(next.value);
        } catch (error) {
          const code = errorCode(error) ?? TRANSPORT_STREAM_CONTRACT_INVALID;
          const written = await writeStreamCheckpoint({
            store: options.store,
            namespace: options.namespace,
            bindingId: options.binding.id,
            cursor: latestCheckpoint?.cursor ?? null,
            lease: options.lease,
            now: options.now,
            ownerId: options.ownerId,
            configRef: options.binding.configRef,
            status: "active",
            lastErrorCode: code,
            previous: latestCheckpoint,
          });

          if (written.kind === "rejected") {
            return {
              accepted,
              duplicated,
              checkpointed,
              failed: true,
              leaseLost: true,
              outcome: "lease_lost",
              lastErrorCode: code,
            };
          }

          return {
            accepted,
            duplicated,
            checkpointed,
            failed: true,
            leaseLost: false,
            outcome: "contract_invalid",
            lastErrorCode: code,
          };
        }

        if (item.kind === "cursor") {
          const written = await writeStreamCheckpoint({
            store: options.store,
            namespace: options.namespace,
            bindingId: options.binding.id,
            cursor: item.cursor,
            lease: options.lease,
            now: options.now,
            ownerId: options.ownerId,
            configRef: options.binding.configRef,
            status: "active",
            clearError: true,
            previous: latestCheckpoint,
          });

          if (written.kind === "rejected") {
            await bestEffortIteratorReturn(iterator);
            return {
              accepted,
              duplicated,
              checkpointed,
              failed: true,
              leaseLost: true,
              outcome: "lease_lost",
            };
          }

          if (written.kind === "accepted") {
            checkpointed = true;
            latestCheckpoint = written.checkpoint;
          }
          continue;
        }

        const itemResult = await acceptStreamEnvelope({
          options,
          item,
          signal: streamControl.signal,
          latestCheckpoint,
        });

        if (itemResult.kind === "aborted") {
          await bestEffortIteratorReturn(iterator);
          return abortedOutcome(
            options.lease,
            accepted,
            duplicated,
            checkpointed,
          );
        }

        if (itemResult.kind === "failed") {
          return {
            accepted,
            duplicated,
            checkpointed,
            failed: true,
            leaseLost: itemResult.leaseLost,
            outcome: itemResult.leaseLost ? "lease_lost" : "transient",
            lastErrorCode: itemResult.code,
          };
        }

        if (itemResult.kind === "accepted") {
          accepted += 1;
        } else if (itemResult.kind === "duplicate") {
          duplicated += 1;
        }

        if (item.cursor === undefined) {
          continue;
        }

        if (streamControl.signal.aborted || isLeaseExpired(options.lease)) {
          await bestEffortIteratorReturn(iterator);
          return abortedOutcome(
            options.lease,
            accepted,
            duplicated,
            checkpointed,
          );
        }

        const written = await writeStreamCheckpoint({
          store: options.store,
          namespace: options.namespace,
          bindingId: options.binding.id,
          cursor: item.cursor,
          lease: options.lease,
          now: options.now,
          ownerId: options.ownerId,
          configRef: options.binding.configRef,
          status: "active",
          clearError: true,
          previous: latestCheckpoint,
        });

        if (written.kind === "rejected") {
          await bestEffortIteratorReturn(iterator);
          return {
            accepted,
            duplicated,
            checkpointed,
            failed: true,
            leaseLost: true,
            outcome: "lease_lost",
          };
        }

        if (written.kind === "accepted") {
          checkpointed = true;
          latestCheckpoint = written.checkpoint;
        }
      }
    } finally {
      // Best-effort return when the loop exits via throw; normal done/abort
      // paths already return or call iterator.return.
      await bestEffortIteratorReturn(iterator);
    }
  } finally {
    streamControl.dispose();
  }
}

/**
 * Lease-fenced stream checkpoint write with config identity and status.
 *
 * @remarks Shared by the single-connection fiber and the reconnect loop
 * (exhaustion / terminal fault paths).
 */
export async function writeStreamCheckpoint(options: {
  readonly store: RuntimeStoreAdapter;
  readonly namespace: string;
  readonly bindingId: string;
  readonly cursor: string | null;
  readonly lease: Lease;
  readonly now: Date;
  readonly ownerId?: string;
  readonly configRef: RuntimeTransportConfigRef;
  readonly status: RuntimeTransportBindingStatus;
  readonly clearError?: boolean;
  readonly lastErrorCode?: string;
  readonly previous: RuntimeTransportBindingCheckpoint | null;
}): Promise<
  | {
      readonly kind: "accepted";
      readonly checkpoint: RuntimeTransportBindingCheckpoint;
    }
  | { readonly kind: "rejected" }
  | { readonly kind: "skipped" }
> {
  const port = options.store.transports;
  if (!port?.putBindingCheckpoint) {
    return { kind: "skipped" };
  }

  const nowIso = options.now.toISOString();
  const checkpoint: RuntimeTransportBindingCheckpoint = Object.freeze({
    schemaVersion: 1 as const,
    namespace: options.namespace,
    bindingId: options.bindingId,
    cursor: options.cursor,
    updatedAt: nowIso,
    lastPolledAt: nowIso,
    ...(options.ownerId !== undefined ? { lastOwnerId: options.ownerId } : {}),
    ...(options.clearError
      ? {}
      : options.lastErrorCode !== undefined
        ? { lastErrorCode: options.lastErrorCode }
        : options.previous?.lastErrorCode !== undefined
          ? { lastErrorCode: options.previous.lastErrorCode }
          : {}),
    configRef: Object.freeze({
      id: options.configRef.id,
      revision: options.configRef.revision,
    }),
    status: options.status,
  });

  const result = await port.putBindingCheckpoint({
    checkpoint,
    lease: options.lease,
  });

  if (result.kind === "rejected") {
    return { kind: "rejected" };
  }

  return { kind: "accepted", checkpoint };
}

/** Load the durable binding checkpoint, or null when unsupported/missing. */
export async function loadBindingCheckpoint(
  store: RuntimeStoreAdapter,
  namespace: string,
  bindingId: string,
): Promise<RuntimeTransportBindingCheckpoint | null> {
  const port = store.transports;
  if (!port?.getBindingCheckpoint) {
    return null;
  }

  return port.getBindingCheckpoint({ namespace, bindingId });
}

/** Structural equality for existing configRef shapes (id + revision). */
export function sameTransportConfigRef(
  left: RuntimeTransportConfigRef,
  right: RuntimeTransportConfigRef,
): boolean {
  return left.id === right.id && left.revision === right.revision;
}

async function acceptStreamEnvelope(args: {
  readonly options: RunStreamConnectionOptions;
  readonly item: StreamEnvelopeItem;
  readonly signal: AbortSignal;
  readonly latestCheckpoint: RuntimeTransportBindingCheckpoint | null;
}): Promise<
  | { readonly kind: "accepted" }
  | { readonly kind: "duplicate" }
  | { readonly kind: "aborted" }
  | {
      readonly kind: "failed";
      readonly leaseLost: boolean;
      readonly code?: string;
    }
> {
  const { options, item, signal, latestCheckpoint } = args;

  if (signal.aborted || isLeaseExpired(options.lease)) {
    return { kind: "aborted" };
  }

  const envelope = envelopeFromStreamItem(options.binding, item, options.now);

  try {
    const result = await acceptTransportEnvelope({
      store: options.store,
      namespace: options.namespace,
      envelope,
      now: options.now,
    });

    if (signal.aborted || isLeaseExpired(options.lease)) {
      return { kind: "aborted" };
    }

    if (result.kind === "accepted") {
      return { kind: "accepted" };
    }
    if (result.kind === "duplicate") {
      return { kind: "duplicate" };
    }
    return { kind: "duplicate" };
  } catch (error) {
    if (signal.aborted || isAbortError(error)) {
      return { kind: "aborted" };
    }

    if (error instanceof TransportEnvelopeConflictError) {
      const evidence = await loadDurableEnvelopeEvidence({
        store: options.store,
        namespace: options.namespace,
        provider: error.provider,
        accountId: error.accountId,
        eventId: error.eventId,
      });
      if (evidence) {
        return { kind: "duplicate" };
      }

      const code = error.code;
      const written = await writeStreamCheckpoint({
        store: options.store,
        namespace: options.namespace,
        bindingId: options.binding.id,
        cursor: latestCheckpoint?.cursor ?? null,
        lease: options.lease,
        now: options.now,
        ownerId: options.ownerId,
        configRef: options.binding.configRef,
        status: "active",
        lastErrorCode: code,
        previous: latestCheckpoint,
      });

      return {
        kind: "failed",
        leaseLost: written.kind === "rejected",
        code,
      };
    }

    const code = errorCode(error) ?? "TRANSPORT_ACCEPT_FAILED";
    const written = await writeStreamCheckpoint({
      store: options.store,
      namespace: options.namespace,
      bindingId: options.binding.id,
      cursor: latestCheckpoint?.cursor ?? null,
      lease: options.lease,
      now: options.now,
      ownerId: options.ownerId,
      configRef: options.binding.configRef,
      status: "active",
      lastErrorCode: code,
      previous: latestCheckpoint,
    });

    return {
      kind: "failed",
      leaseLost: written.kind === "rejected",
      code,
    };
  }
}

async function handleConnectionError(args: {
  readonly error: unknown;
  readonly options: RunStreamConnectionOptions;
  readonly latestCheckpoint: RuntimeTransportBindingCheckpoint | null;
  readonly accepted: number;
  readonly duplicated: number;
  readonly checkpointed: boolean;
  readonly signal: AbortSignal;
}): Promise<RunStreamConnectionResult> {
  const {
    error,
    options,
    latestCheckpoint,
    accepted,
    duplicated,
    checkpointed,
    signal,
  } = args;

  if (signal.aborted || isAbortError(error) || isLeaseExpired(options.lease)) {
    return abortedOutcome(options.lease, accepted, duplicated, checkpointed);
  }

  if (isManagedStreamTerminalError(error)) {
    const code =
      managedStreamTerminalErrorCode(error) ?? "TRANSPORT_STREAM_TERMINAL";
    const written = await writeStreamCheckpoint({
      store: options.store,
      namespace: options.namespace,
      bindingId: options.binding.id,
      cursor: latestCheckpoint?.cursor ?? null,
      lease: options.lease,
      now: options.now,
      ownerId: options.ownerId,
      configRef: options.binding.configRef,
      status: "faulted",
      lastErrorCode: code,
      previous: latestCheckpoint,
    });

    return {
      accepted,
      duplicated,
      checkpointed,
      failed: true,
      leaseLost: written.kind === "rejected",
      outcome: written.kind === "rejected" ? "lease_lost" : "terminal",
      lastErrorCode: code,
    };
  }

  const code = errorCode(error) ?? "TRANSPORT_STREAM_FAILED";
  const written = await writeStreamCheckpoint({
    store: options.store,
    namespace: options.namespace,
    bindingId: options.binding.id,
    cursor: latestCheckpoint?.cursor ?? null,
    lease: options.lease,
    now: options.now,
    ownerId: options.ownerId,
    configRef: options.binding.configRef,
    status: "active",
    lastErrorCode: code,
    previous: latestCheckpoint,
  });

  return {
    accepted,
    duplicated,
    checkpointed,
    failed: true,
    leaseLost: written.kind === "rejected",
    outcome: written.kind === "rejected" ? "lease_lost" : "transient",
    lastErrorCode: code,
  };
}

function envelopeFromStreamItem(
  binding: RuntimeManagedTransportBinding,
  item: StreamEnvelopeItem,
  now: Date,
): RuntimeAcceptedTransportEnvelope {
  return {
    _tag: "RuntimeAcceptedTransportEnvelope",
    schemaVersion: 1,
    bindingId: binding.id,
    adapterId: binding.adapter.id,
    provider: binding.adapter.provider,
    accountId: item.accountId,
    eventId: item.eventId,
    receivedAt: now.toISOString(),
    authenticatedRouting: item.authenticatedRouting,
    payload: item.payload,
    configRef: binding.configRef,
    target: binding.target,
  };
}

async function loadDurableEnvelopeEvidence(options: {
  readonly store: RuntimeStoreAdapter;
  readonly namespace: string;
  readonly provider: string;
  readonly accountId: string;
  readonly eventId: string;
}): Promise<boolean> {
  const port = options.store.transports;
  if (!port) {
    return false;
  }

  try {
    const record = await port.get({
      namespace: options.namespace,
      provider: options.provider,
      accountId: options.accountId,
      eventId: options.eventId,
    });
    return record !== null;
  } catch {
    return false;
  }
}

function abortedOutcome(
  lease: Lease,
  accepted: number,
  duplicated: number,
  checkpointed: boolean,
): RunStreamConnectionResult {
  return {
    accepted,
    duplicated,
    checkpointed,
    failed: false,
    leaseLost: isLeaseExpired(lease),
    outcome: isLeaseExpired(lease) ? "lease_lost" : "aborted",
  };
}

function errorCode(error: unknown): string | undefined {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string"
  ) {
    const code = (error as { code: string }).code;
    if (isSafeProviderErrorCode(code)) {
      return code;
    }
  }
  return undefined;
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === "AbortError") ||
    (typeof DOMException !== "undefined" &&
      error instanceof DOMException &&
      error.name === "AbortError")
  );
}

async function bestEffortReturn(
  iterable: AsyncIterable<StreamItem>,
): Promise<void> {
  const iterator = iterable[Symbol.asyncIterator]();
  await bestEffortIteratorReturn(iterator);
}

async function bestEffortIteratorReturn(
  iterator: AsyncIterator<StreamItem>,
): Promise<void> {
  try {
    await iterator.return?.();
  } catch {
    // Adapter cleanup must not mask abort/lease-loss outcomes.
  }
}
