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
import { scopeProviderSignalsForEnvelope } from "./publication-scope";
import {
  appendTransportFacts,
  failNormalizationAttempt,
  instrumentSignalsForLineage,
  statsIdentity,
  type NormalizeClaimedTransportEnvelopeResult,
} from "./normalize-helpers";

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

export type { NormalizeClaimedTransportEnvelopeResult };

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
    if (!tx.transports) {
      throw new TransportStoreMissingError();
    }

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
 * @remarks Successful publication marks the envelope `normalized` and records
 * Signal occurrence lineage. Failures schedule bounded retry or dead-letter.
 * Statistics update in the same store transaction as the lifecycle transition.
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

  const lineage: Array<{ signalId: string; occurrenceId: string }> = [];

  try {
    const scoped = scopeProviderSignalsForEnvelope(
      options.provider.signals,
      options.record.envelope,
    );
    const instrumented = instrumentSignalsForLineage(scoped, lineage);

    await options.provider.onEvent(options.record.envelope, {
      signals: instrumented,
    });
  } catch (error) {
    return failNormalizationAttempt({
      store: options.store,
      identity,
      leaseToken,
      now,
      record: options.record,
      error,
      rng: options.rng,
    });
  }

  const completed = await options.store.transact(async (tx) => {
    if (!tx.transports) {
      throw new TransportStoreMissingError();
    }

    const record = await tx.transports.completeNormalization({
      identity,
      leaseToken,
      now,
      lineage,
    });

    if (!record) {
      return null;
    }

    // Credit stats only when this claim completed the transition. Idempotent
    // re-complete of an already-normalized row must not double-count.
    const transitioned =
      record.state === "normalized" &&
      options.record.state === "claimed" &&
      record.updatedAt === now.toISOString();

    if (transitioned) {
      await appendTransportFacts(tx.transports, options.record, now, [
        {
          kind: "transport-envelope",
          identity: statsIdentity(options.record),
          outcome: "normalized",
        },
        ...(lineage.length > 0
          ? [
              {
                kind: "transport-envelope" as const,
                identity: statsIdentity(options.record),
                outcome: "delivered" as const,
              },
            ]
          : []),
      ]);
    }

    return record;
  });

  if (!completed) {
    return { kind: "lost-lease" };
  }

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
    if (!tx.transports) {
      throw new TransportStoreMissingError();
    }

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
