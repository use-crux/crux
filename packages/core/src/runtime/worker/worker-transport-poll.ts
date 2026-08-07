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

const MAX_EVENTS_PER_POLL = 64;

/** Options for one leased poll/accept/checkpoint cycle. */
export interface PollAndAcceptOptions {
  readonly store: RuntimeStoreAdapter;
  readonly namespace: string;
  readonly binding: RuntimeManagedTransportBinding;
  readonly provider: SignalProvider;
  readonly transport: PollingTransport;
  readonly checkpoint: RuntimeTransportBindingCheckpoint | null;
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
}

/**
 * Poll one binding, accept each event through the shared envelope kernel, and
 * write the cursor only after the full batch is durably accepted.
 */
export async function pollAndAccept(
  options: PollAndAcceptOptions,
): Promise<PollAndAcceptResult> {
  if (options.signal.aborted) {
    return emptyOutcome();
  }

  let polled: PollResult;
  try {
    polled = await options.transport.poll({
      cursor: options.checkpoint?.cursor ?? null,
      signal: options.signal,
      configRef: options.binding.configRef,
    });
  } catch (error) {
    if (options.signal.aborted || isAbortError(error)) {
      return emptyOutcome();
    }
    await recordPollFailure({
      store: options.store,
      namespace: options.namespace,
      bindingId: options.binding.id,
      checkpoint: options.checkpoint,
      now: options.now,
      ownerId: options.ownerId,
      code: errorCode(error) ?? "TRANSPORT_POLL_FAILED",
    });
    return {
      accepted: 0,
      duplicated: 0,
      checkpointed: false,
      failed: true,
    };
  }

  if (options.signal.aborted) {
    return emptyOutcome();
  }

  const batch = validatePollResult(polled);
  let accepted = 0;
  let duplicated = 0;

  for (const event of batch.events) {
    if (options.signal.aborted) {
      return {
        accepted,
        duplicated,
        checkpointed: false,
        failed: false,
      };
    }

    const envelope = envelopeFromPollEvent(options.binding, event, options.now);
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
      await recordPollFailure({
        store: options.store,
        namespace: options.namespace,
        bindingId: options.binding.id,
        checkpoint: options.checkpoint,
        now: options.now,
        ownerId: options.ownerId,
        code: errorCode(error) ?? "TRANSPORT_ACCEPT_FAILED",
      });
      return {
        accepted,
        duplicated,
        checkpointed: false,
        failed: true,
      };
    }
  }

  await writeCheckpoint({
    store: options.store,
    namespace: options.namespace,
    bindingId: options.binding.id,
    cursor: batch.nextCursor,
    previous: options.checkpoint,
    now: options.now,
    ownerId: options.ownerId,
    clearError: true,
    morePending: batch.more === true,
  });

  return {
    accepted,
    duplicated,
    checkpointed: true,
    failed: false,
  };
}

/** Persist a safe poll failure without advancing the cursor. */
export async function recordPollFailure(options: {
  readonly store: RuntimeStoreAdapter;
  readonly namespace: string;
  readonly bindingId: string;
  readonly checkpoint: RuntimeTransportBindingCheckpoint | null;
  readonly now: Date;
  readonly ownerId?: string;
  readonly code: string;
}): Promise<void> {
  await writeCheckpoint({
    store: options.store,
    namespace: options.namespace,
    bindingId: options.bindingId,
    cursor: options.checkpoint?.cursor ?? null,
    previous: options.checkpoint,
    now: options.now,
    ownerId: options.ownerId,
    lastErrorCode: options.code,
  });
}

function emptyOutcome(): PollAndAcceptResult {
  return {
    accepted: 0,
    duplicated: 0,
    checkpointed: false,
    failed: false,
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
  readonly now: Date;
  readonly ownerId?: string;
  readonly clearError?: boolean;
  readonly lastErrorCode?: string;
  readonly morePending?: boolean;
}): Promise<void> {
  const port = options.store.transports;
  if (!port?.putBindingCheckpoint) {
    return;
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
  await port.putBindingCheckpoint(checkpoint);
}

function errorCode(error: unknown): string | undefined {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string"
  ) {
    return (error as { code: string }).code;
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
