/**
 * One leased polling binding: poll, durable accept, checkpoint.
 *
 * @module
 */

import type { SignalProvider } from "../../signal/provider";
import type {
  PollEvent,
  PollResult,
  PollingTransport,
} from "../../signal/transport";
import type { Lease } from "../ports/leases";
import type { RuntimeStoreAdapter } from "../store";
import { acceptTransportEnvelope } from "../transport/accept";
import {
  MAX_TRANSPORT_BINDING_CURSOR_BYTES,
  type RuntimeTransportBindingCheckpoint,
} from "../transport/binding-checkpoint";
import type {
  RuntimeAcceptedTransportEnvelope,
  RuntimeManagedTransportBinding,
} from "../transport/contracts";
import { TransportEnvelopeConflictError } from "../transport/lifecycle-errors";
import {
  createLeaseBoundPollSignal,
  isLeaseExpired,
} from "./worker-transport-poll-signal";

const MAX_EVENTS_PER_POLL = 64;

/** Options for one leased poll/accept/checkpoint cycle. */
export interface PollAndAcceptOptions {
  readonly store: RuntimeStoreAdapter;
  readonly namespace: string;
  readonly binding: RuntimeManagedTransportBinding;
  readonly provider: SignalProvider;
  readonly transport: PollingTransport;
  readonly checkpoint: RuntimeTransportBindingCheckpoint | null;
  /** Active binding lease that fences durable checkpoint writes. */
  readonly lease: Lease;
  readonly signal: AbortSignal;
  readonly now: Date;
  readonly ownerId?: string;
}

/** Bounded outcome of one poll/accept/checkpoint cycle. */
export interface PollAndAcceptResult {
  readonly accepted: number;
  readonly duplicated: number;
  readonly checkpointed: boolean;
  readonly failed: boolean;
  /**
   * True when a checkpoint write was rejected because the binding lease fence
   * was stale, incorrect, or expired.
   */
  readonly leaseLost: boolean;
}

/**
 * Poll one binding, accept each event through the shared envelope kernel, and
 * write the cursor only after the full batch is durably accepted.
 *
 * @remarks Each `transport.poll` receives a derived {@link AbortSignal} that
 * aborts when the parent worker signal aborts or the active binding lease
 * reaches `expiresAt`. Timers and parent listeners are cleared before return.
 * After deadline or parent abort, a late poll page is dropped: no accept and
 * no checkpoint write. The lease-fenced checkpoint port remains the durable
 * ownership backstop.
 *
 * {@link TransportEnvelopeConflictError} is progressable only when the shared
 * envelope store still holds durable identity evidence for that provider/
 * account/event (accepted, claimed, normalized, or dead-letter). Other accept
 * failures retain fail-without-checkpoint semantics. Conflicts never invent a
 * parallel dead-letter store or silently drop events without that evidence.
 */
export async function pollAndAccept(
  options: PollAndAcceptOptions,
): Promise<PollAndAcceptResult> {
  const pollControl = createLeaseBoundPollSignal(
    options.signal,
    options.lease,
  );

  try {
    if (pollControl.signal.aborted) {
      return abortedOutcome(options.lease);
    }

    let polled: PollResult;
    try {
      polled = await options.transport.poll({
        cursor: options.checkpoint?.cursor ?? null,
        signal: pollControl.signal,
        configRef: options.binding.configRef,
      });
    } catch (error) {
      if (pollControl.signal.aborted || isAbortError(error)) {
        return abortedOutcome(options.lease);
      }
      const failure = await recordPollFailure({
        store: options.store,
        namespace: options.namespace,
        bindingId: options.binding.id,
        checkpoint: options.checkpoint,
        lease: options.lease,
        now: options.now,
        ownerId: options.ownerId,
        code: errorCode(error) ?? "TRANSPORT_POLL_FAILED",
      });
      return {
        accepted: 0,
        duplicated: 0,
        checkpointed: false,
        failed: true,
        leaseLost: failure.leaseLost,
      };
    }

    // Drop late pages when the parent stopped or the binding lease deadline
    // elapsed, even if the provider ignored cooperative cancellation.
    if (pollControl.signal.aborted || isLeaseExpired(options.lease)) {
      return abortedOutcome(options.lease);
    }

    let batch: PollResult;
    try {
      batch = validatePollResult(polled);
    } catch {
      const failure = await recordPollFailure({
        store: options.store,
        namespace: options.namespace,
        bindingId: options.binding.id,
        checkpoint: options.checkpoint,
        lease: options.lease,
        now: options.now,
        ownerId: options.ownerId,
        code: "TRANSPORT_POLL_CONTRACT_INVALID",
      });
      return {
        accepted: 0,
        duplicated: 0,
        checkpointed: false,
        failed: true,
        leaseLost: failure.leaseLost,
      };
    }

    let accepted = 0;
    let duplicated = 0;

    for (const event of batch.events) {
      if (pollControl.signal.aborted || isLeaseExpired(options.lease)) {
        return {
          accepted,
          duplicated,
          checkpointed: false,
          failed: false,
          leaseLost: isLeaseExpired(options.lease),
        };
      }

      const envelope = envelopeFromPollEvent(
        options.binding,
        event,
        options.now,
      );
      try {
        const result = await acceptTransportEnvelope({
          store: options.store,
          namespace: options.namespace,
          envelope,
          now: options.now,
        });
        if (result.kind === "accepted") {
          accepted += 1;
        } else if (result.kind === "duplicate") {
          duplicated += 1;
        }
      } catch (error) {
        if (error instanceof TransportEnvelopeConflictError) {
          const evidence = await loadDurableEnvelopeEvidence({
            store: options.store,
            namespace: options.namespace,
            provider: error.provider,
            accountId: error.accountId,
            eventId: error.eventId,
          });
          if (evidence) {
            // Identity already recorded in the shared envelope store; advance.
            continue;
          }
          const failure = await recordPollFailure({
            store: options.store,
            namespace: options.namespace,
            bindingId: options.binding.id,
            checkpoint: options.checkpoint,
            lease: options.lease,
            now: options.now,
            ownerId: options.ownerId,
            code: error.code,
          });
          return {
            accepted,
            duplicated,
            checkpointed: false,
            failed: true,
            leaseLost: failure.leaseLost,
          };
        }

        const failure = await recordPollFailure({
          store: options.store,
          namespace: options.namespace,
          bindingId: options.binding.id,
          checkpoint: options.checkpoint,
          lease: options.lease,
          now: options.now,
          ownerId: options.ownerId,
          code: errorCode(error) ?? "TRANSPORT_ACCEPT_FAILED",
        });
        return {
          accepted,
          duplicated,
          checkpointed: false,
          failed: true,
          leaseLost: failure.leaseLost,
        };
      }
    }

    if (pollControl.signal.aborted || isLeaseExpired(options.lease)) {
      return {
        accepted,
        duplicated,
        checkpointed: false,
        failed: false,
        leaseLost: isLeaseExpired(options.lease),
      };
    }

    const written = await writeCheckpoint({
      store: options.store,
      namespace: options.namespace,
      bindingId: options.binding.id,
      cursor: batch.nextCursor,
      previous: options.checkpoint,
      lease: options.lease,
      now: options.now,
      ownerId: options.ownerId,
      clearError: true,
      morePending: batch.more === true,
    });

    if (written.kind === "rejected") {
      return {
        accepted,
        duplicated,
        checkpointed: false,
        failed: true,
        leaseLost: true,
      };
    }

    return {
      accepted,
      duplicated,
      checkpointed: written.kind === "accepted",
      failed: false,
      leaseLost: false,
    };
  } finally {
    pollControl.dispose();
  }
}

/** Persist a safe poll failure without advancing the cursor. */
export async function recordPollFailure(options: {
  readonly store: RuntimeStoreAdapter;
  readonly namespace: string;
  readonly bindingId: string;
  readonly checkpoint: RuntimeTransportBindingCheckpoint | null;
  readonly lease: Lease;
  readonly now: Date;
  readonly ownerId?: string;
  readonly code: string;
}): Promise<{ readonly leaseLost: boolean }> {
  const written = await writeCheckpoint({
    store: options.store,
    namespace: options.namespace,
    bindingId: options.bindingId,
    cursor: options.checkpoint?.cursor ?? null,
    previous: options.checkpoint,
    lease: options.lease,
    now: options.now,
    ownerId: options.ownerId,
    lastErrorCode: options.code,
  });
  return { leaseLost: written.kind === "rejected" };
}

/**
 * Confirm durable envelope-store evidence for one provider event identity.
 *
 * @remarks Uses the existing transport envelope port only — never a side
 * dead-letter table. Any persisted lifecycle state counts: the first accepted
 * payload remains the durable authority after a digest conflict.
 */
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

function emptyOutcome(): PollAndAcceptResult {
  return {
    accepted: 0,
    duplicated: 0,
    checkpointed: false,
    failed: false,
    leaseLost: false,
  };
}

/** Empty cycle result after parent abort or active binding-lease deadline. */
function abortedOutcome(lease: Lease): PollAndAcceptResult {
  return {
    accepted: 0,
    duplicated: 0,
    checkpointed: false,
    failed: false,
    leaseLost: isLeaseExpired(lease),
  };
}

function validatePollResult(value: PollResult): PollResult {
  if (
    value === null ||
    typeof value !== "object" ||
    !Array.isArray(value.events)
  ) {
    throw new TypeError("polling transport must return { events, nextCursor }.");
  }
  if (value.events.length > MAX_EVENTS_PER_POLL) {
    throw new RangeError(
      `polling transport returned more than ${MAX_EVENTS_PER_POLL} events in one pass.`,
    );
  }
  if (value.nextCursor !== null && typeof value.nextCursor !== "string") {
    throw new TypeError(
      "polling nextCursor must be a non-empty trimmed string without ASCII controls, or null.",
    );
  }
  if (value.nextCursor !== null) {
    validateCursor(value.nextCursor);
  }
  for (const event of value.events) {
    if (
      !event ||
      typeof event.accountId !== "string" ||
      typeof event.eventId !== "string"
    ) {
      throw new TypeError(
        "polling transport events require accountId and eventId strings.",
      );
    }
  }
  return {
    events: Object.freeze([...value.events]),
    nextCursor: value.nextCursor,
    ...(value.more === true ? { more: true as const } : {}),
  };
}

function validateCursor(cursor: string): void {
  if (!cursor || cursor.trim() !== cursor || /[\x00-\x1f\x7f]/.test(cursor)) {
    throw new TypeError(
      "polling nextCursor must be a non-empty trimmed string without ASCII controls, or null.",
    );
  }
  if (
    new TextEncoder().encode(cursor).byteLength >
    MAX_TRANSPORT_BINDING_CURSOR_BYTES
  ) {
    throw new RangeError(
      `polling nextCursor must be at most ${MAX_TRANSPORT_BINDING_CURSOR_BYTES} UTF-8 bytes.`,
    );
  }
}

function envelopeFromPollEvent(
  binding: RuntimeManagedTransportBinding,
  event: PollEvent,
  now: Date,
): RuntimeAcceptedTransportEnvelope {
  return {
    _tag: "RuntimeAcceptedTransportEnvelope",
    schemaVersion: 1,
    bindingId: binding.id,
    adapterId: binding.adapter.id,
    provider: binding.adapter.provider,
    accountId: event.accountId,
    eventId: event.eventId,
    receivedAt: now.toISOString(),
    authenticatedRouting: event.authenticatedRouting,
    payload: event.payload,
    configRef: binding.configRef,
    target: binding.target,
  };
}

async function writeCheckpoint(options: {
  readonly store: RuntimeStoreAdapter;
  readonly namespace: string;
  readonly bindingId: string;
  readonly cursor: string | null;
  readonly previous: RuntimeTransportBindingCheckpoint | null;
  readonly lease: Lease;
  readonly now: Date;
  readonly ownerId?: string;
  readonly clearError?: boolean;
  readonly lastErrorCode?: string;
  readonly morePending?: boolean;
}): Promise<{ readonly kind: "accepted" | "rejected" | "skipped" }> {
  const port = options.store.transports;
  if (!port?.putBindingCheckpoint) {
    return { kind: "skipped" };
  }

  const nowIso = options.now.toISOString();
  const morePending =
    options.morePending === true
      ? true
      : options.clearError
        ? undefined
        : options.previous?.morePending === true
          ? true
          : undefined;

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
    ...(morePending === true ? { morePending: true as const } : {}),
  });
  return port.putBindingCheckpoint({
    checkpoint,
    lease: options.lease,
  });
}

/**
 * Provider-derived failure codes stored on checkpoints must stay bounded and
 * secret-free. Accept only ASCII `[A-Za-z0-9_.-]` with length 1..64.
 */
const SAFE_PROVIDER_ERROR_CODE = /^[A-Za-z0-9_.-]{1,64}$/;

function errorCode(error: unknown): string | undefined {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string"
  ) {
    const code = (error as { code: string }).code;
    if (SAFE_PROVIDER_ERROR_CODE.test(code)) {
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
