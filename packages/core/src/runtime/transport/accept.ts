/**
 * Durable accept-before-ack boundary for managed transport envelopes.
 *
 * @module
 */

import type { StatisticsFact } from "../../statistics";
import type { RuntimeStoreAdapter } from "../store";
import type { RuntimeAcceptedTransportEnvelope } from "./contracts";
import { validateRuntimeAcceptedTransportEnvelope } from "./validation";
import { transportEnvelopeDigest } from "./digest";
import type { RuntimeTransportEnvelopeRecord } from "./records";
import {
  TransportEnvelopeConflictError,
  TransportStoreMissingError,
} from "./lifecycle-errors";
import { DEFAULT_RUNTIME_MAX_ATTEMPTS } from "../engine/retry";
import {
  initialTransportStatistics,
  recordTransportStatistics,
  transportStatisticsIdentity,
} from "./statistics";

/** Options for durable transport envelope acceptance. */
export interface AcceptTransportEnvelopeOptions {
  /** Runtime store that exposes a transactional transport port. */
  readonly store: RuntimeStoreAdapter;
  /** Runtime namespace that owns the envelope identity. */
  readonly namespace: string;
  /** Authenticated, validated accepted-envelope data. */
  readonly envelope: RuntimeAcceptedTransportEnvelope;
  /** Maximum normalization attempts before dead-letter. */
  readonly maxAttempts?: number;
  /** Clock used for acceptance timestamps. */
  readonly now?: Date;
}

/**
 * Result of durable acceptance.
 *
 * @remarks `acknowledge: true` means the host may acknowledge the provider.
 * Conflicts must not be acknowledged as success.
 */
export type AcceptTransportEnvelopeResult =
  | {
      readonly kind: "accepted";
      readonly acknowledge: true;
      readonly record: RuntimeTransportEnvelopeRecord;
    }
  | {
      readonly kind: "duplicate";
      readonly acknowledge: true;
      readonly record: RuntimeTransportEnvelopeRecord;
    }
  | {
      readonly kind: "conflict";
      readonly acknowledge: false;
      readonly record: RuntimeTransportEnvelopeRecord;
    };

/**
 * Durably accept one authenticated transport envelope.
 *
 * @remarks Call only after edge authentication and request validation complete.
 * The Promise resolves after the accept transaction commits. Hosts must send
 * the provider acknowledgment only when `acknowledge` is `true`. Bounded
 * accepted/deduplicated statistics update in the same transaction.
 */
export async function acceptTransportEnvelope(
  options: AcceptTransportEnvelopeOptions,
): Promise<AcceptTransportEnvelopeResult> {
  const envelope = validateRuntimeAcceptedTransportEnvelope(options.envelope);
  const now = options.now ?? new Date();
  const maxAttempts = options.maxAttempts ?? DEFAULT_RUNTIME_MAX_ATTEMPTS;
  const digest = transportEnvelopeDigest(envelope);

  const result = await options.store.transact(async (tx) => {
    if (!tx.transports) {
      throw new TransportStoreMissingError();
    }

    const accepted = await tx.transports.accept({
      namespace: options.namespace,
      envelope,
      envelopeDigest: digest,
      maxAttempts,
      now,
    });

    if (accepted.kind === "conflict") {
      return accepted;
    }

    const fact: StatisticsFact = {
      kind: "transport-envelope",
      identity: transportStatisticsIdentity(
        envelope.adapterId,
        envelope.bindingId,
      ),
      outcome: accepted.kind === "accepted" ? "accepted" : "deduplicated",
    };
    const previous =
      (await tx.transports.getStatistics(options.namespace)) ??
      initialTransportStatistics(options.namespace, now);

    await tx.transports.putStatistics(
      options.namespace,
      recordTransportStatistics(previous, options.namespace, now, [fact]),
    );

    return accepted;
  });

  if (result.kind === "conflict") {
    const error = new TransportEnvelopeConflictError(
      envelope.provider,
      envelope.accountId,
      envelope.eventId,
    );

    Object.defineProperty(error, "result", {
      value: Object.freeze({
        kind: "conflict",
        acknowledge: false,
        record: result.record,
      } satisfies AcceptTransportEnvelopeResult),
      enumerable: false,
    });

    throw error;
  }

  return Object.freeze({
    kind: result.kind,
    acknowledge: true,
    record: result.record,
  });
}
