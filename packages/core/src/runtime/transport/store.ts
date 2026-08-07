/**
 * Runtime store port for durable managed-transport envelopes.
 *
 * @module
 */

import type { StatisticsLedgerExport } from "../../statistics";
import type { RuntimePruneOptions, RuntimePruneResult } from "../ports/retention";
import type {
  RuntimeTransportDeliveryLineageEntry,
  RuntimeTransportEnvelopeIdentity,
  RuntimeTransportEnvelopeRecord,
} from "./records";
import type { RuntimeAcceptedTransportEnvelope } from "./contracts";

/** Input for first acceptance of one authenticated envelope. */
export interface AcceptRuntimeTransportEnvelopeInput {
  readonly namespace: string;
  readonly envelope: RuntimeAcceptedTransportEnvelope;
  readonly envelopeDigest: string;
  readonly maxAttempts: number;
  readonly now: Date;
}

/** Atomic accept outcome before host acknowledgment. */
export type AcceptRuntimeTransportEnvelopeResult =
  | {
      readonly kind: "accepted";
      readonly record: RuntimeTransportEnvelopeRecord;
    }
  | {
      readonly kind: "duplicate";
      readonly record: RuntimeTransportEnvelopeRecord;
    }
  | {
      readonly kind: "conflict";
      readonly record: RuntimeTransportEnvelopeRecord;
    };

/** Options for claiming accepted or retryable envelopes. */
export interface ClaimRuntimeTransportEnvelopesOptions {
  readonly namespace: string;
  readonly now: Date;
  readonly limit: number;
  readonly leaseMs: number;
  readonly leaseToken: string;
}

/** Input for completing normalization after provider `onEvent` succeeds. */
export interface CompleteRuntimeTransportNormalizationInput {
  readonly identity: RuntimeTransportEnvelopeIdentity;
  readonly leaseToken: string;
  readonly now: Date;
  /**
   * Signal publications produced by this normalization pass.
   *
   * @remarks Occurrence ids only. Never include payloads or credentials.
   */
  readonly lineage?: readonly RuntimeTransportDeliveryLineageEntry[];
}

/** Input for recording a failed normalization attempt. */
export interface FailRuntimeTransportNormalizationInput {
  readonly identity: RuntimeTransportEnvelopeIdentity;
  readonly leaseToken: string;
  readonly now: Date;
  readonly nextAttemptAt: Date;
  readonly message: string;
  readonly code?: string;
}

/** Input for returning a dead-lettered envelope to the accepted state. */
export interface ReplayRuntimeTransportEnvelopeInput {
  readonly identity: RuntimeTransportEnvelopeIdentity;
  readonly now: Date;
}

/**
 * Transactional store operations for managed-transport envelopes.
 *
 * @remarks Implementations must keep accept, claim, complete, fail, replay, and
 * statistics updates atomic with the surrounding Runtime transaction. Statistics
 * use the shared statistics ledger export, not a second metrics store.
 */
export interface RuntimeTransportStorePort {
  /** Load one envelope by provider/account/event identity. */
  get(
    identity: RuntimeTransportEnvelopeIdentity,
  ): Promise<RuntimeTransportEnvelopeRecord | null>;
  /**
   * Accept one authenticated envelope idempotently.
   *
   * @remarks Same identity and digest returns `duplicate`. Same identity with a
   * different digest returns `conflict` without mutation.
   */
  accept(
    input: AcceptRuntimeTransportEnvelopeInput,
  ): Promise<AcceptRuntimeTransportEnvelopeResult>;
  /** Claim eligible accepted envelopes for normalization. */
  claim(
    options: ClaimRuntimeTransportEnvelopesOptions,
  ): Promise<readonly RuntimeTransportEnvelopeRecord[]>;
  /** Mark a claimed envelope normalized when provider publication completes. */
  completeNormalization(
    input: CompleteRuntimeTransportNormalizationInput,
  ): Promise<RuntimeTransportEnvelopeRecord | null>;
  /**
   * Record a failed claim attempt and either schedule retry or dead-letter.
   *
   * @remarks When `attempts >= maxAttempts`, the record becomes `dead-letter`.
   */
  failNormalization(
    input: FailRuntimeTransportNormalizationInput,
  ): Promise<RuntimeTransportEnvelopeRecord | null>;
  /** Return a dead-lettered envelope to `accepted` for explicit operator replay. */
  replay(
    input: ReplayRuntimeTransportEnvelopeInput,
  ): Promise<RuntimeTransportEnvelopeRecord | null>;
  /** Load the restart-safe namespace transport statistics ledger export. */
  getStatistics(namespace: string): Promise<StatisticsLedgerExport | null>;
  /** Persist the namespace transport statistics ledger export. */
  putStatistics(
    namespace: string,
    statistics: StatisticsLedgerExport,
  ): Promise<void>;
  /**
   * Prune terminal envelopes older than the retention cutoff.
   *
   * @remarks Only `normalized` and `dead-letter` rows are eligible. Active
   * accepted/claimed work is never removed by retention.
   */
  prune(options: RuntimePruneOptions): Promise<RuntimePruneResult>;
}
