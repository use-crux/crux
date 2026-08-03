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
import type { RuntimeApplicationWorkState } from "./application-work-state";

/**
 * Kernel-owned lifecycle state for a {@link RuntimeWorkItem}.
 *
 * @remarks
 * `pending` work is eligible for delivery after `notBefore`; `leased` work is
 * owned by one fenced executor; and `suspended` work is waiting for a durable
 * resume condition. `completed` and `cancelled` are terminal. `blocked` records
 * require an operator or configuration fix before retry, while `dead-letter`
 * records exhausted their automatic attempt budget.
 *
 * Store adapters persist this value but must not add states or choose
 * transitions. The Runtime Engine kernel is the state-machine owner.
 */
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

/**
 * Durable queue record exchanged between the Runtime Engine kernel and a
 * {@link RuntimeStatePort} implementation.
 *
 * @remarks
 * The kernel owns record identity, lifecycle transitions, attempts, leases,
 * retry timing, and terminal errors. A store adapter must losslessly persist
 * and reconstruct every Core-owned field; it must not synthesize transitions
 * or retry decisions.
 *
 * Adapter packages may add optional, adapter-owned fields with declaration
 * merging through the public `@use-crux/core/runtime` module. The adapter is
 * responsible for initializing and round-tripping those fields:
 *
 * ```ts
 * declare module "@use-crux/core/runtime" {
 *   interface RuntimeWorkItem {
 *     readonly storageRevision?: string;
 *   }
 * }
 * ```
 */
export interface RuntimeWorkItem {
  /** Kernel-generated identity retained across every attempt of this work. */
  readonly workId: WorkId;
  /** Runtime namespace and required persistence partition for this record. */
  readonly namespace: string;
  /** Kernel-defined routing payload; adapters must treat its contents as opaque. */
  readonly work: RuntimeWork;
  /** Stable name used by the kernel to resolve the registered execution target. */
  readonly targetId: RuntimeTargetId;
  /** Current kernel-owned lifecycle state. */
  readonly status: RuntimeWorkState;
  /** One-based logical execution attempt; transport retries do not increment it. */
  readonly attempt: number;
  /** Maximum logical attempts before the kernel moves work to `dead-letter`. */
  readonly maxAttempts: number;
  /** Earliest eligible delivery time for pending work. */
  readonly notBefore?: Date;
  /** Idempotency key for the current logical delivery intent. */
  readonly idempotencyKey: string;
  /** Optional idle-counter scope held until the work reaches a terminal state. */
  readonly idleScope?: string;
  /** Fencing token present only while the work is leased to an executor. */
  readonly leaseToken?: LeaseToken;
  /** Latest inspectable kernel error for blocked or failed work. */
  readonly lastError?: WorkItemError;
  /** Internal content-addressed result reference committed on completion. */
  readonly resultRef?: RuntimeResultRef;
  /** Safe bounded metadata for public application Work handles. */
  readonly application?: RuntimeApplicationWorkState;
  /** Time the kernel first accepted this work occurrence. */
  readonly createdAt: Date;
  /** Time of the most recent kernel-owned lifecycle transition. */
  readonly updatedAt: Date;
}

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
      return to === "pending" || to === "cancelled";
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
