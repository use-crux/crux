/**
 * Restart-safe normalization of accepted transport envelopes.
 *
 * @module
 */

import type { SignalProvider } from "../../signal/provider";
import type { RuntimeStoreAdapter } from "../store";
import type { RuntimeTransportEnvelopeRecord } from "./records";
import {
  TransportEnvelopeNotFoundError,
  TransportEnvelopeNotReplayableError,
  TransportStoreMissingError,
} from "./lifecycle-errors";
import { DEFAULT_RUNTIME_MAX_ATTEMPTS } from "../engine/retry";
import { retryDelayMs } from "../engine/retry";

/** Options for claiming accepted envelopes for normalization. */
export interface ClaimTransportEnvelopesOptions {
  readonly store: RuntimeStoreAdapter;
  readonly namespace: string;
  readonly now?: Date;
  readonly limit?: number;
  readonly leaseMs?: number;
  readonly leaseToken?: string;
}

/** Options for normalizing one already-claimed envelope through a provider. */
export interface NormalizeClaimedTransportEnvelopeOptions {
  readonly store: RuntimeStoreAdapter;
  readonly provider: SignalProvider;
  readonly record: RuntimeTransportEnvelopeRecord;
  readonly now?: Date;
  readonly rng?: () => number;
}

/** Outcome of one claimed-envelope normalization attempt. */
export type NormalizeClaimedTransportEnvelopeResult =
  | {
      readonly kind: "normalized";
      readonly record: RuntimeTransportEnvelopeRecord;
    }
  | {
      readonly kind: "retried";
      readonly record: RuntimeTransportEnvelopeRecord;
    }
  | {
      readonly kind: "dead-lettered";
      readonly record: RuntimeTransportEnvelopeRecord;
    }
  | {
      readonly kind: "lost-lease";
    };

/** Options for explicit operator replay of a dead-lettered envelope. */
export interface ReplayTransportEnvelopeOptions {
  readonly store: RuntimeStoreAdapter;
  readonly namespace: string;
  readonly provider: string;
  readonly accountId: string;
  readonly eventId: string;
  readonly now?: Date;
}

const DEFAULT_LEASE_MS = 30_000;

/** Claim accepted or retry-due envelopes for restart-safe normalization. */
export async function claimTransportEnvelopes(
  options: ClaimTransportEnvelopesOptions,
): Promise<readonly RuntimeTransportEnvelopeRecord[]> {
  const now = options.now ?? new Date();
  const leaseToken =
    options.leaseToken ??
    `transport-lease:${now.toISOString()}:${Math.random().toString(36).slice(2)}`;
  return options.store.transact(async (tx) => {
    if (!tx.transports) throw new TransportStoreMissingError();
    return tx.transports.claim({
      namespace: options.namespace,
      now,
      limit: options.limit ?? 16,
      leaseMs: options.leaseMs ?? DEFAULT_LEASE_MS,
      leaseToken,
    });
  });
}

/**
 * Run provider `onEvent` for one claimed envelope and settle its lifecycle.
 *
 * @remarks Successful publication marks the envelope `normalized` idempotently.
 * Failures schedule bounded retry or transition to `dead-letter`.
 */
export async function normalizeClaimedTransportEnvelope(
  options: NormalizeClaimedTransportEnvelopeOptions,
): Promise<NormalizeClaimedTransportEnvelopeResult> {
  const now = options.now ?? new Date();
  const identity = {
    namespace: options.record.namespace,
    provider: options.record.provider,
    accountId: options.record.accountId,
    eventId: options.record.eventId,
  };
  const leaseToken = options.record.leaseToken;
  if (!leaseToken) {
    return { kind: "lost-lease" };
  }

  try {
    await options.provider.onEvent(options.record.envelope, {
      signals: options.provider.signals,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Transport normalization failed.";
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code: unknown }).code)
        : undefined;
    const delayMs = retryDelayMs({
      attempt: options.record.attempts,
      rng: options.rng,
    });
    const nextAttemptAt = new Date(now.getTime() + delayMs);
    const failed = await options.store.transact(async (tx) => {
      if (!tx.transports) throw new TransportStoreMissingError();
      return tx.transports.failNormalization({
        identity,
        leaseToken,
        now,
        nextAttemptAt,
        message,
        code,
      });
    });
    if (!failed) return { kind: "lost-lease" };
    return Object.freeze({
      kind: failed.state === "dead-letter" ? "dead-lettered" : "retried",
      record: failed,
    });
  }

  const completed = await options.store.transact(async (tx) => {
    if (!tx.transports) throw new TransportStoreMissingError();
    return tx.transports.completeNormalization({
      identity,
      leaseToken,
      now,
    });
  });
  if (!completed) return { kind: "lost-lease" };
  return Object.freeze({ kind: "normalized", record: completed });
}

/**
 * Return a dead-lettered envelope to `accepted` for another normalization pass.
 *
 * @remarks Explicit operator action only. Automatic workers never invent replay.
 */
export async function replayTransportEnvelope(
  options: ReplayTransportEnvelopeOptions,
): Promise<RuntimeTransportEnvelopeRecord> {
  const now = options.now ?? new Date();
  const identity = {
    namespace: options.namespace,
    provider: options.provider,
    accountId: options.accountId,
    eventId: options.eventId,
  };
  const record = await options.store.transact(async (tx) => {
    if (!tx.transports) throw new TransportStoreMissingError();
    const existing = await tx.transports.get(identity);
    if (!existing) {
      throw new TransportEnvelopeNotFoundError(
        identity.provider,
        identity.accountId,
        identity.eventId,
      );
    }
    if (existing.state !== "dead-letter") {
      throw new TransportEnvelopeNotReplayableError(
        identity.provider,
        identity.accountId,
        identity.eventId,
        existing.state,
      );
    }
    return tx.transports.replay({ identity, now });
  });
  if (!record) {
    throw new TransportEnvelopeNotFoundError(
      identity.provider,
      identity.accountId,
      identity.eventId,
    );
  }
  return record;
}

export { DEFAULT_RUNTIME_MAX_ATTEMPTS };
