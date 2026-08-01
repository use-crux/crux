/**
 * Pure runtime work state machine.
 *
 * The kernel is the only layer allowed to move a {@link RuntimeWorkItem} between
 * states. Adapters persist the resulting record, but they never invent their
 * own status transitions.
 *
 * @module
 */

import type { LeaseToken, RuntimeTargetId, WorkId } from "../ports/ids";
import type { RuntimeWork } from "../ports/work";
import { cloneRuntimeResultRef, type RuntimeResultRef } from "../results/types";
import type { JsonValue } from "../../storage";

/** Durable execution state for a runtime work item. */
export type RuntimeWorkState =
  | "pending"
  | "leased"
  | "suspended"
  | "completed"
  | "cancelled"
  | "blocked"
  | "dead-letter";

/** Inspectable error summary attached to blocked or failed work. */
export interface WorkItemError {
  /** Stable Crux runtime error code, such as `TARGET_NOT_FOUND`. */
  readonly code: string;
  /** Human-readable diagnostic summary. */
  readonly message: string;
  /** Time when the runtime recorded this error. */
  readonly at: Date;
  /** Optional durable machine-readable context owned by the error producer. */
  readonly details?: JsonValue;
}

/** Durable runtime work record owned by the kernel state machine. */
export interface RuntimeWorkItem {
  /** Kernel-generated stable work id. */
  readonly workId: WorkId;
  /** Runtime namespace isolating environments that share a substrate. */
  readonly namespace: string;
  /** Small routing payload describing the work to execute. */
  readonly work: RuntimeWork;
  /** Durable name-based target id for diagnostics and target lookup. */
  readonly targetId: RuntimeTargetId;
  /** Current kernel-owned execution status. */
  readonly status: RuntimeWorkState;
  /** One-based delivery attempt count. */
  readonly attempt: number;
  /** Maximum attempts before work becomes dead-lettered. */
  readonly maxAttempts: number;
  /** Earliest time this work should be delivered again. */
  readonly notBefore?: Date;
  /** Stable idempotency key for the current delivery. */
  readonly idempotencyKey: string;
  /** Scoped-idle counter group this item keeps busy until terminal. */
  readonly idleScope?: string;
  /** Lease token while a worker owns this item. */
  readonly leaseToken?: LeaseToken;
  /** Last user-facing runtime error attached to this item. */
  readonly lastError?: WorkItemError;
  /** Private content-addressed result committed with completed work. */
  readonly resultRef?: RuntimeResultRef;
  /** Creation timestamp. */
  readonly createdAt: Date;
  /** Last state transition timestamp. */
  readonly updatedAt: Date;
}

/** @deprecated Use RuntimeWorkState instead. */
export type WorkStatus = RuntimeWorkState;

/** @deprecated Use RuntimeWorkItem instead. */
export type WorkItem = RuntimeWorkItem;

/** Transition request accepted by {@link transition}. */
export type WorkTransition =
  | {
      readonly status: "leased";
      readonly leaseToken: LeaseToken;
    }
  | {
      readonly status: "completed";
      readonly resultRef?: RuntimeResultRef;
    }
  | {
      readonly status: "suspended" | "cancelled";
    }
  | {
      readonly status: "pending";
      readonly attempt?: number;
      readonly notBefore?: Date;
      readonly idempotencyKey?: string;
    }
  | {
      readonly status: "blocked" | "dead-letter";
      readonly lastError: WorkItemError;
    };

/**
 * Return a new work item after applying a legal state transition.
 *
 * @param work - Current durable work record.
 * @param next - Requested target status and required transition metadata.
 * @returns A frozen copy with the new status applied.
 * @throws Error when the requested transition is not legal for the current status.
 */
export function transition(
  work: RuntimeWorkItem,
  next: WorkTransition,
): RuntimeWorkItem {
  if (!isLegalTransition(work.status, next.status)) {
    throw new Error(
      `Illegal runtime work transition: ${work.status} -> ${next.status}`,
    );
  }

  const withoutLease = omitLease(work);
  return Object.freeze({
    ...withoutLease,
    status: next.status,
    ...(next.status === "leased" ? { leaseToken: next.leaseToken } : {}),
    ...(next.status === "pending" && next.attempt !== undefined
      ? { attempt: next.attempt }
      : {}),
    ...(next.status === "pending" && next.notBefore !== undefined
      ? { notBefore: next.notBefore }
      : {}),
    ...(next.status === "pending" && next.idempotencyKey !== undefined
      ? { idempotencyKey: next.idempotencyKey }
      : {}),
    ...(next.status === "blocked" || next.status === "dead-letter"
      ? { lastError: next.lastError }
      : {}),
    ...(next.status === "completed" && next.resultRef
      ? { resultRef: cloneRuntimeResultRef(next.resultRef) }
      : {}),
    updatedAt: new Date(),
  });
}

function isLegalTransition(
  from: RuntimeWorkState,
  to: RuntimeWorkState,
): boolean {
  switch (from) {
    case "pending":
      return to === "leased" || to === "blocked" || to === "cancelled";
    case "leased":
      return (
        to === "completed" ||
        to === "suspended" ||
        to === "pending" ||
        to === "dead-letter" ||
        to === "blocked" ||
        to === "cancelled"
      );
    case "suspended":
      return to === "pending" || to === "cancelled";
    case "blocked":
    case "dead-letter":
      return to === "pending";
    case "completed":
    case "cancelled":
      return false;
  }
}

function omitLease(
  work: RuntimeWorkItem,
): Omit<RuntimeWorkItem, "leaseToken"> {
  const { leaseToken, ...withoutLease } = work;
  void leaseToken;
  return withoutLease;
}
