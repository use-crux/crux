/**
 * Safe operator/Devtools projections for managed-transport envelopes.
 *
 * @module
 */

import type {
  RuntimeTransportDeliveryLineageEntry,
  RuntimeTransportEnvelopeRecord,
} from "./records";

export type { RuntimeTransportDeliveryLineageEntry };

/**
 * Privacy-safe envelope projection for observability and Devtools.
 *
 * @remarks Omits payload bytes, payload refs, authenticated routing values,
 * credentials, and any raw provider body. Lineage reuses Signal occurrence
 * identities already owned by the Signal runtime.
 */
export interface RuntimeTransportEnvelopeProjection {
  readonly namespace: string;
  readonly provider: string;
  readonly accountId: string;
  readonly eventId: string;
  readonly bindingId: string;
  readonly adapterId: string;
  readonly state: RuntimeTransportEnvelopeRecord["state"];
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly acceptedAt: string;
  readonly updatedAt: string;
  readonly nextAttemptAt: string;
  readonly lastFailure?: RuntimeTransportEnvelopeRecord["lastFailure"];
  readonly lineage: readonly RuntimeTransportDeliveryLineageEntry[];
  readonly configRefId: string;
  readonly configRefRevision: string;
  readonly targetSignalId: string;
}

/**
 * Project one durable envelope record into a credential-free operator view.
 *
 * @param record - Durable envelope store record.
 * @returns Frozen projection without payloads or secrets.
 */
export function projectTransportEnvelope(
  record: RuntimeTransportEnvelopeRecord,
): RuntimeTransportEnvelopeProjection {
  const lastFailure = record.lastFailure
    ? Object.freeze({ ...record.lastFailure })
    : undefined;

  return Object.freeze({
    namespace: record.namespace,
    provider: record.provider,
    accountId: record.accountId,
    eventId: record.eventId,
    bindingId: record.bindingId,
    adapterId: record.envelope.adapterId,
    state: record.state,
    attempts: record.attempts,
    maxAttempts: record.maxAttempts,
    acceptedAt: record.acceptedAt,
    updatedAt: record.updatedAt,
    nextAttemptAt: record.nextAttemptAt,
    ...(lastFailure ? { lastFailure } : {}),
    lineage: Object.freeze(
      (record.lineage ?? []).map((entry) =>
        Object.freeze({
          signalId: entry.signalId,
          occurrenceId: entry.occurrenceId,
        }),
      ),
    ),
    configRefId: record.envelope.configRef.id,
    configRefRevision: record.envelope.configRef.revision,
    targetSignalId: record.envelope.target.signalId,
  });
}
