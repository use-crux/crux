/**
 * Logical Runtime records for durable Signal acceptance and delivery.
 *
 * @module
 */

import type { JsonValue } from "../../storage";
import type { SignalPayloadCodec } from "./payload-codec";

/** Stable reference to one durable reactive consumer. */
export type ReactiveConsumerRef =
  | {
      /** Consumer kind used for delivery routing. */
      readonly kind: "flow.signal-wait";
      /** Durable Flow occurrence waiting for the Signal. */
      readonly flowId: string;
      /** Waiter resolved by this delivery. */
      readonly waiterId: string;
      /** Suspended work item resumed by this delivery. */
      readonly workId: string;
    }
  | {
      /** Independent Session Signal subscription consumer. */
      readonly kind: "session.subscription";
      /** Session that owns the durable subscription. */
      readonly sessionId: string;
      /** Stable subscription identity within the Session. */
      readonly subscriptionId: string;
    };

/** Canonical durable Signal occurrence. */
export interface SignalOccurrenceRecord {
  /** Record schema version. */
  readonly schemaVersion: 1;
  /** Runtime namespace that owns the occurrence. */
  readonly namespace: string;
  /** Stable accepted occurrence identity. */
  readonly occurrenceId: string;
  /** Application-authored Signal identity. */
  readonly signalId: string;
  /** Adapter-opaque encoded payload when `payloadCodec` is present. */
  readonly payload: JsonValue;
  /** Lossless payload encoding used by new records; absent on legacy rows. */
  readonly payloadCodec?: SignalPayloadCodec;
  /** ISO timestamp when publication was accepted. */
  readonly acceptedAt: string;
  /** Versioned hash of the caller idempotency key and canonical payload scope. */
  readonly idempotencyHash?: string;
}

/** Independent durable delivery derived from one Signal occurrence. */
export interface SignalDeliveryRecord {
  /** Record schema version. */
  readonly schemaVersion: 1;
  /** Runtime namespace that owns the delivery. */
  readonly namespace: string;
  /** Stable identity reused across delivery attempts. */
  readonly deliveryId: string;
  /** Accepted occurrence delivered to the consumer. */
  readonly occurrenceId: string;
  /** Durable consumer that owns this delivery. */
  readonly consumer: ReactiveConsumerRef;
  /** Current at-least-once delivery lifecycle state. */
  readonly state: "pending" | "leased" | "delivered" | "failed" | "dead-letter";
  /** Number of consumer delivery attempts. */
  readonly attempts: number;
  /** ISO timestamp of the latest delivery transition. */
  readonly updatedAt: string;
}

/** Runtime-store operations required by durable Signal composites. */
export interface RuntimeSignalStorePort {
  /** Load one accepted occurrence by identity. */
  getOccurrence(
    namespace: string,
    occurrenceId: string,
  ): Promise<SignalOccurrenceRecord | null>;
  /** Find the canonical occurrence for a hashed idempotency key. */
  findOccurrenceByIdempotency(
    namespace: string,
    signalId: string,
    idempotencyHash: string,
  ): Promise<SignalOccurrenceRecord | null>;
  /** Persist one accepted occurrence in the active transaction. */
  putOccurrence(record: SignalOccurrenceRecord): Promise<void>;
  /** Load one required delivery by identity. */
  getDelivery(
    namespace: string,
    deliveryId: string,
  ): Promise<SignalDeliveryRecord | null>;
  /** List every required delivery derived from an occurrence. */
  listDeliveries(
    namespace: string,
    occurrenceId: string,
  ): Promise<readonly SignalDeliveryRecord[]>;
  /** Persist one required delivery in the active transaction. */
  putDelivery(record: SignalDeliveryRecord): Promise<void>;
}
