/**
 * Durable runtime state port contract.
 *
 * The state port stores work records, idempotency keys, flow snapshots, and
 * runtime counters. Adapters persist records; the kernel owns state-machine
 * legality, retry policy, and composite transaction ordering.
 *
 * @module
 */

import type { JsonValue } from "../../storage";
import type { RuntimeWorkItem } from "../engine/work";
import type {
  EventCursor,
  FlowId,
  RuntimeTargetId,
  WaiterId,
  WorkId,
} from "./ids";
import type { RuntimeWork } from "./work";
import type { RuntimeWorkState } from "../engine/work";
import type { RuntimePruneOptions, RuntimePruneResult } from "./retention";
import type { FlowSnapshot } from "./flow-state";
export type {
  FlowSnapshot,
  RuntimeDeliveredSuspend,
  RuntimeDeliveredSuspends,
  RuntimePendingSuspend,
  RuntimeScheduledWork,
} from "./flow-state";

/** Idempotency marker written atomically with completed transitions. */
export interface IdempotencyRecord {
  /** Runtime namespace. */
  readonly namespace: string;
  /** Stable idempotency key. */
  readonly key: string;
  /** Time when the guarded operation completed durably. */
  readonly completedAt: Date;
}

/** Durable state read options. */
export interface RuntimeStateReadOptions {
  /** Runtime namespace. */
  readonly namespace: string;
}

/** Input for creating a fresh pending runtime work item. */
export interface NewWorkItem {
  /** Kernel-minted stable work id. */
  readonly workId: WorkId;
  /** Runtime namespace. */
  readonly namespace: string;
  /** Small routing payload describing the work to execute. */
  readonly work: RuntimeWork;
  /** Name-based runtime target id. */
  readonly targetId: RuntimeTargetId;
  /** Stable idempotency key for the first delivery. */
  readonly idempotencyKey: string;
  /** Earliest time this work should be delivered. */
  readonly notBefore?: Date;
  /** Attempts allowed before dead-letter. Defaults to the engine default. */
  readonly maxAttempts?: number;
  /** Timestamp override for deterministic tests. Defaults to now. */
  readonly now?: Date;
  /** Scoped-idle counter group this work keeps busy until terminal. */
  readonly idleScope?: string;
}

/** Options for moving an existing suspended item back to pending. */
export interface SetWorkPendingOptions extends RuntimeStateReadOptions {
  /** Work payload to carry on the fresh delivery intent. */
  readonly work: RuntimeWork;
  /** Stable idempotency key for the fresh delivery intent. */
  readonly idempotencyKey: string;
  /** Timestamp override for deterministic runtimes. Defaults to now. */
  readonly now?: Date;
  /**
   * Current statuses that may be moved back to pending.
   *
   * Defaults to `suspended`, which is the flow waiter/timer resume path.
   * Operator retry uses `blocked` and `dead-letter` through the same store CAS.
   */
  readonly from?: RuntimeWorkState | readonly RuntimeWorkState[];
}

/** Delivered event metadata to attach to a pending suspend by waiter id. */
export interface MarkSnapshotDeliveredOptions extends RuntimeStateReadOptions {
  /** Waiter that won the event/timeout race. */
  readonly waiterId: WaiterId;
  /** Durable event cursor that produced the delivered payload. */
  readonly eventId: EventCursor;
  /** JSON payload copied into the snapshot for future replay. */
  readonly payload: JsonValue;
  /** Append a predicate candidate without consuming its logical waiter. */
  readonly predicateCandidate?: true;
}

/** Bounded work-listing options used by kernel-owned maintenance. */
export interface ListWorkOptions {
  /** Runtime namespace to list within. */
  readonly namespace: string;
  /** Work status to list. */
  readonly status: RuntimeWorkState;
  /** Only include records updated before this time. */
  readonly updatedBefore?: Date;
  /**
   * When set, only return rows whose work payload `kind` matches.
   *
   * @remarks Session boundary settlement uses this with
   * `session.signal-ingress` so unrelated pending Work cannot crowd out the
   * Session's deferred ingress. Adapters should push the filter into the store
   * query when possible.
   */
  readonly kind?: RuntimeWork["kind"];
  /**
   * When set, only return session-scoped work for this Session id.
   *
   * @remarks Combined with {@link ListWorkOptions.kind} for targeted Agent
   * Signal-ingress settlement. Ignored for work kinds without `sessionId`.
   */
  readonly sessionId?: string;
  /** Maximum number of records to return. */
  readonly limit?: number;
}

/** Grouped work-count query used by operator status surfaces. */
export interface CountWorkOptions {
  /** Runtime namespace to count within. */
  readonly namespace: string;
}

/** Count of work rows grouped by status and target. */
export interface WorkStatusCount {
  /** Runtime namespace for this count bucket. */
  readonly namespace: string;
  /** Work status for this count bucket. */
  readonly status: RuntimeWorkState;
  /** Runtime target id for this count bucket. */
  readonly targetId: RuntimeTargetId;
  /** Number of rows in this bucket. */
  readonly count: number;
  /** True when an adapter hit a bounded-read cap before proving the exact count. */
  readonly truncated?: boolean;
}

/** Durable state port used by the runtime kernel. */
export interface RuntimeStatePort {
  /**
   * Create a fresh pending work item.
   *
   * Used for work that is minted at enqueue/fire time, such as task runs and
   * future trigger/watch deliveries. Flow waiter firing uses
   * {@link RuntimeStatePort.setWorkPending} instead so a flow occurrence keeps
   * one work item for its whole lifecycle.
   *
   * When `work.idleScope` is present, adapters must increment that namespace's
   * idle counter exactly once with the inserted work row. Kernel-owned terminal
   * transitions decrement the same counter through `putWork()`/transactional
   * state updates; counters must never go below zero.
   */
  createWork(work: NewWorkItem): Promise<RuntimeWorkItem>;

  /**
   * Load a work item by id.
   *
   * Reads may happen concurrently with wake delivery. The kernel treats
   * terminal work as idempotent duplicate delivery.
   */
  getWork(
    workId: WorkId,
    options: RuntimeStateReadOptions,
  ): Promise<RuntimeWorkItem | null>;

  /**
   * Persist a work item produced by the kernel state machine.
   *
   * Adapters must not perform their own status transitions or retry decisions.
   */
  putWork(work: RuntimeWorkItem): Promise<void>;

  /**
   * List bounded work records for kernel-owned maintenance.
   *
   * Adapters only filter and return records; expiry-vs-failure decisions,
   * cancellation legality, retry, and retention policy stay in the kernel.
   */
  listWork(options: ListWorkOptions): Promise<readonly RuntimeWorkItem[]>;

  /**
   * Delete completed, cancelled, and dead-lettered work updated before a cutoff.
   *
   * Pending, leased, suspended, and blocked work is never pruned by retention.
   */
  pruneTerminalWork(options: RuntimePruneOptions): Promise<RuntimePruneResult>;

  /**
   * Count work records for operator/devtools status without sampling rows.
   *
   * SQL-style adapters should return exact grouped counts. Bounded platforms may
   * set `truncated` when they hit a platform read cap before proving the exact
   * count, so callers never mistake a capped sample for an exact total.
   */
  countWork(options: CountWorkOptions): Promise<readonly WorkStatusCount[]>;

  /**
   * Move an existing suspended work item back to pending.
   *
   * This is the waiter/timer resume composite: it compare-and-sets
   * `suspended -> pending`, rewrites the delivery work payload, resets the
   * attempt counter to `1`, clears retry metadata, and returns `null` when
   * the item is already terminal, cancelled, or otherwise no longer suspended.
   */
  setWorkPending(
    workId: WorkId,
    options: SetWorkPendingOptions,
  ): Promise<RuntimeWorkItem | null>;

  /**
   * Load a flow snapshot by id.
   *
   * Snapshot ids are generated by flow handles; runtime-backed replay reads
   * them through this port instead of the object-bound record-store path.
   */
  getSnapshot(
    flowId: FlowId,
    options: RuntimeStateReadOptions,
  ): Promise<FlowSnapshot | null>;

  /**
   * Persist a runtime-backed flow snapshot.
   *
   * Snapshot writes participate in composite transactions in store adapters
   * that support atomic multi-record updates.
   */
  putSnapshot(snapshot: FlowSnapshot): Promise<void>;

  /**
   * Delete terminal flow snapshots updated before a cutoff.
   *
   * Running and suspended snapshots are never pruned by retention.
   */
  pruneTerminalSnapshots(
    options: RuntimePruneOptions,
  ): Promise<RuntimePruneResult>;

  /**
   * Record which durable event delivered a pending suspend point.
   *
   * Called inside the same transaction that fires the waiter and resumes the
   * owning work item. Replay later reads the copied payload from the snapshot,
   * so event retention does not affect already-delivered suspends.
   */
  markSnapshotDelivered(
    workId: WorkId,
    options: MarkSnapshotDeliveredOptions,
  ): Promise<void>;

  /**
   * Check whether a stable idempotency key has already completed.
   *
   * Idempotency records are generated by the kernel and scoped by namespace.
   */
  hasIdempotencyKey(namespace: string, key: string): Promise<boolean>;

  /**
   * Persist a completed idempotency record.
   *
   * Composite operations write this atomically with their state transition so a
   * crash can never record one without the other.
   */
  putIdempotencyKey(record: IdempotencyRecord): Promise<void>;

  /** Delete completed idempotency markers older than the retention cutoff. */
  pruneIdempotencyKeys(
    options: RuntimePruneOptions,
  ): Promise<RuntimePruneResult>;

  /**
   * Increment a scoped-idle counter and return the new count.
   *
   * Called from work creation transactions when a newly minted item carries an
   * idle scope. The counter represents non-terminal work in that scope.
   */
  incrementIdle(namespace: string, scope: string): Promise<number>;

  /**
   * Decrement a scoped-idle counter and return the new count.
   *
   * Called by kernel terminal transitions. Implementations should reject
   * negative counts because that indicates a kernel accounting bug.
   */
  decrementIdle(namespace: string, scope: string): Promise<number>;

  /**
   * Read the current scoped-idle counter.
   *
   * Used by future `untilIdle` registration to avoid lost wakeups when the
   * scope is already idle.
   */
  getIdleCount(namespace: string, scope: string): Promise<number>;
}
