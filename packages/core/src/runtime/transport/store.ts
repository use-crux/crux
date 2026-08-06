/**
 * Runtime store port for durable managed-transport envelopes.
 *
 * @module
 */

import type {
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
 * @remarks Implementations must keep accept, claim, complete, fail, and replay
 * transitions atomic with the surrounding Runtime transaction.
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
}
