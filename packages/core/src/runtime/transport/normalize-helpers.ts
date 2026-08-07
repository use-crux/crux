/**
 * Normalization helpers for transport envelope lifecycle and lineage.
 *
 * @module
 */

import type { SignalPublishOptions, SignalPublishReceipt } from "../../signal/publication";
import type { StatisticsFact } from "../../statistics";
import type { RuntimeStoreAdapter } from "../store";
import { retryDelayMs } from "../engine/retry";
import { TransportStoreMissingError } from "./lifecycle-errors";
import type {
  RuntimeTransportDeliveryLineageEntry,
  RuntimeTransportEnvelopeRecord,
} from "./records";
import type { RuntimeTransportStorePort } from "./store";
import {
  initialTransportStatistics,
  recordTransportStatistics,
  transportStatisticsIdentity,
} from "./statistics";

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

/**
 * Record a failed claim attempt, schedule retry or dead-letter, and update stats.
 */
export async function failNormalizationAttempt(options: {
  readonly store: RuntimeStoreAdapter;
  readonly identity: {
    readonly namespace: string;
    readonly provider: string;
    readonly accountId: string;
    readonly eventId: string;
  };
  readonly leaseToken: string;
  readonly now: Date;
  readonly record: RuntimeTransportEnvelopeRecord;
  readonly error: unknown;
  readonly rng?: () => number;
}): Promise<NormalizeClaimedTransportEnvelopeResult> {
  const message =
    options.error instanceof Error
      ? options.error.message
      : "Transport normalization failed.";
  const code =
    options.error &&
    typeof options.error === "object" &&
    "code" in options.error
      ? String((options.error as { code: unknown }).code)
      : undefined;
  const delayMs = retryDelayMs({
    attempt: options.record.attempts,
    rng: options.rng,
  });
  const nextAttemptAt = new Date(options.now.getTime() + delayMs);

  const failed = await options.store.transact(async (tx) => {
    if (!tx.transports) {
      throw new TransportStoreMissingError();
    }

    const record = await tx.transports.failNormalization({
      identity: options.identity,
      leaseToken: options.leaseToken,
      now: options.now,
      nextAttemptAt,
      message,
      code,
    });

    if (!record) {
      return null;
    }

    const outcome =
      record.state === "dead-letter" ? "dead-lettered" : "retried";

    await appendTransportFacts(tx.transports, options.record, options.now, [
      {
        kind: "transport-envelope",
        identity: statsIdentity(options.record),
        outcome,
      },
    ]);

    return record;
  });

  if (!failed) {
    return { kind: "lost-lease" };
  }

  return Object.freeze({
    kind: failed.state === "dead-letter" ? "dead-lettered" : "retried",
    record: failed,
  });
}

/** Adapter/binding identity key used for bounded transport statistics. */
export function statsIdentity(record: RuntimeTransportEnvelopeRecord): string {
  return transportStatisticsIdentity(
    record.envelope.adapterId,
    record.bindingId,
  );
}

/** Append mechanical transport facts to the namespace statistics ledger. */
export async function appendTransportFacts(
  transports: RuntimeTransportStorePort,
  record: RuntimeTransportEnvelopeRecord,
  now: Date,
  facts: readonly StatisticsFact[],
): Promise<void> {
  const previous =
    (await transports.getStatistics(record.namespace)) ??
    initialTransportStatistics(record.namespace, now);

  await transports.putStatistics(
    record.namespace,
    recordTransportStatistics(previous, record.namespace, now, facts),
  );
}

type ProviderSignalRuntime = {
  readonly id: string;
  publish(
    payload: unknown,
    options?: SignalPublishOptions,
  ): Promise<SignalPublishReceipt>;
};

/**
 * Wrap provider Signal publishes so successful receipts become envelope lineage.
 *
 * @remarks Lineage stores only Signal and occurrence identities — never payloads.
 */
export function instrumentSignalsForLineage<TSignals extends object>(
  signals: TSignals,
  lineage: RuntimeTransportDeliveryLineageEntry[],
): TSignals {
  const instrumented: Record<string, ProviderSignalRuntime> = {};

  for (const [name, definition] of Object.entries(
    signals as Record<string, ProviderSignalRuntime>,
  )) {
    instrumented[name] = Object.freeze({
      ...definition,
      async publish(payload: unknown, options?: SignalPublishOptions) {
        const receipt = await definition.publish(payload, options);

        lineage.push(
          Object.freeze({
            signalId: receipt.signalId,
            occurrenceId: receipt.occurrenceId,
          }),
        );

        return receipt;
      },
    });
  }

  return Object.freeze(instrumented) as unknown as TSignals;
}
