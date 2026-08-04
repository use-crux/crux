/**
 * Durable managed-transport envelope records.
 *
 * @module
 */

import type { RuntimeAcceptedTransportEnvelope } from "./contracts";

/** Lifecycle states for one accepted transport envelope. */
export type RuntimeTransportEnvelopeState =
  | "accepted"
  | "claimed"
  | "normalized"
  | "dead-letter";

/** Bounded diagnostic retained with a failed normalization attempt. */
export interface RuntimeTransportEnvelopeFailure {
  /** Safe failure summary without credentials or raw secrets. */
  readonly message: string;
  /** Optional stable failure code when the host supplies one. */
  readonly code?: string;
}

/**
 * Durable store record for one provider event identity.
 *
 * @remarks Identity is `(namespace, provider, accountId, eventId)`. The
 * envelope digest detects conflicting authenticated payloads for that identity.
 */
export interface RuntimeTransportEnvelopeRecord {
  /** Record schema version. */
  readonly schemaVersion: 1;
  /** Runtime namespace that owns the envelope. */
  readonly namespace: string;
  /** Provider system identity from the accepted envelope. */
  readonly provider: string;
  /** Provider account identity. */
  readonly accountId: string;
  /** Provider event identity. */
  readonly eventId: string;
  /** Managed binding identity that accepted the envelope. */
  readonly bindingId: string;
  /** Detached accepted envelope retained for restart-safe normalization. */
  readonly envelope: RuntimeAcceptedTransportEnvelope;
  /** Canonical digest of the authenticated envelope for conflict detection. */
  readonly envelopeDigest: string;
  /** Current normalization lifecycle state. */
  readonly state: RuntimeTransportEnvelopeState;
  /** Completed normalization attempts including the current claim. */
  readonly attempts: number;
  /** Maximum attempts before dead-letter. */
  readonly maxAttempts: number;
  /** ISO timestamp of durable acceptance. */
  readonly acceptedAt: string;
  /** ISO timestamp of the latest lifecycle transition. */
  readonly updatedAt: string;
  /** Earliest time a claimed or retried envelope may be claimed again. */
  readonly nextAttemptAt: string;
  /** Claim lease token while state is `claimed`. */
  readonly leaseToken?: string;
  /** ISO timestamp when the claim lease expires. */
  readonly leaseExpiresAt?: string;
  /** Latest safe failure diagnostic. */
  readonly lastFailure?: RuntimeTransportEnvelopeFailure;
}

/** Identity used for idempotent acceptance lookup. */
export interface RuntimeTransportEnvelopeIdentity {
  readonly namespace: string;
  readonly provider: string;
  readonly accountId: string;
  readonly eventId: string;
}
