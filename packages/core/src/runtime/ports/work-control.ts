/**
 * Internal Runtime Work-control persistence contracts.
 *
 * Records contain only bounded command identity and acceptance metadata. Raw
 * steering payloads never cross this port.
 *
 * @module
 */

import type { WorkId } from "./ids";

/** Composite identity of one Work-control command. */
export interface WorkControlCommandKey {
  /** Runtime namespace and required persistence partition. */
  readonly namespace: string;
  /** Existing Runtime Work item that owns this command. */
  readonly workId: WorkId;
  /** Caller-provided idempotency identity within the owning Work. */
  readonly commandId: string;
}

/** Immutable inputs pinned when a Work-control command is accepted. */
export interface WorkControlCommandInput extends WorkControlCommandKey {
  /** Bounded digest of the steering payload; the payload itself is never stored. */
  readonly payloadHash: string;
  /** Agent target identity selected when the command was accepted. */
  readonly acceptedAgentTargetId: string;
  /** Immutable resolved-plan identity selected at acceptance. */
  readonly resolvedPlanId: string;
}

/** Current result of accepting a Work-control command. */
export type WorkControlOutcome = "accepted";

/** Immutable JSON-safe record for one accepted Work-control command. */
export interface WorkControlRecord extends WorkControlCommandInput {
  /** Monotonic record revision; initial acceptance is revision 1. */
  readonly revision: number;
  /** Acceptance outcome returned by exact replays. */
  readonly outcome: WorkControlOutcome;
  /** ISO-8601 time when this command was first accepted. */
  readonly createdAt: string;
  /** ISO-8601 time of the latest accepted revision. */
  readonly updatedAt: string;
}

/** Stable immutable acknowledgement returned for acceptance and exact replay. */
export interface WorkControlReceipt extends WorkControlCommandKey {
  /** Agent target identity pinned at acceptance. */
  readonly acceptedAgentTargetId: string;
  /** Resolved-plan identity pinned at acceptance. */
  readonly resolvedPlanId: string;
  /** Accepted record revision. */
  readonly revision: number;
  /** Stable acceptance outcome. */
  readonly outcome: WorkControlOutcome;
  /** ISO-8601 time when this command was first accepted. */
  readonly createdAt: string;
  /** ISO-8601 time of the latest accepted revision. */
  readonly updatedAt: string;
}

/** Store operations for transaction-owned Work-control acceptance. */
export interface RuntimeWorkControlPort {
  /** Load one command only from its namespace and owning Work partition. */
  get(key: WorkControlCommandKey): Promise<WorkControlRecord | null>;
  /** Insert a kernel-owned immutable record without replacing an existing key. */
  create(record: WorkControlRecord): Promise<WorkControlRecord>;
}
