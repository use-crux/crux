/**
 * Durable runtime state port contract.
 *
 * The state port stores work records, idempotency keys, flow snapshots, and
 * runtime counters. Adapters persist records; the kernel owns state-machine
 * legality, retry policy, and composite transaction ordering.
 *
 * @module
 */

import type { JsonValue } from '../../storage'
import type { WorkItem } from '../engine/work'
import type {
  EventCursor,
  FlowId,
  RuntimeTargetId,
  WaiterId,
  TimerId,
  WorkId,
} from './ids'
import type { RuntimeWork } from './work'
import type { WorkStatus } from '../engine/work'

/** Flow snapshot shape persisted by runtime-backed flow replay. */
export interface FlowSnapshot {
  /** Durable flow instance id. */
  readonly flowId: FlowId
  /** Owning runtime work item for this flow occurrence. */
  readonly workId: WorkId
  /** Name-based target id for the flow definition. */
  readonly targetId: RuntimeTargetId
  /** Runtime namespace. */
  readonly namespace: string
  /** Flow lifecycle status. */
  readonly status:
    | 'running'
    | 'suspended'
    | 'completed'
    | 'blocked'
    | 'cancelled'
  /** JSON input captured at first run. */
  readonly input: JsonValue
  /** Existing label-keyed step cache, unchanged by the runtime engine. */
  readonly completedSteps: Readonly<Record<string, JsonValue>>
  /** Ordered replay-structure labels observed so far. */
  readonly fingerprint: readonly string[]
  /** Suspensions currently owned by this snapshot. */
  readonly pendingSuspends: readonly RuntimePendingSuspend[]
  /**
   * Event cursors for suspend deliveries already consumed by replay.
   *
   * Keys use the source-order delivery key emitted by the flow executor, so
   * repeated same-label suspends replay the payload that belongs to their
   * exact occurrence.
   */
  readonly deliveredSuspends?: RuntimeDeliveredSuspends
  /** Durable effects already flushed for replay-visible defer/after calls. */
  readonly scheduledEffects?: Readonly<Record<string, RuntimeScheduledEffect>>
  /** Last update time. */
  readonly updatedAt: Date
}

/** Committed replay-visible durable effect metadata. */
export interface RuntimeScheduledEffect {
  /** Child work id for `flow.defer()` effects. */
  readonly workId?: WorkId
  /** Timer id for `flow.after()` effects. */
  readonly timerId?: TimerId
}

/** Suspension metadata stored with a flow snapshot. */
export interface RuntimePendingSuspend {
  /** User-authored suspend/wait label. */
  readonly label: string
  /** Source-order replay key for disambiguating repeated labels. */
  readonly deliveryKey?: string
  /** Waiter registered for event/signal delivery. */
  readonly waiterId?: WaiterId
  /** Timer registered for timeout delivery. */
  readonly timerId?: TimerId
  /** Event delivery selected for this suspend point. */
  readonly delivered?: RuntimeDeliveredSuspend
}

/** Delivered event metadata recorded for replay to consume later. */
export interface RuntimeDeliveredSuspend {
  /** Durable event cursor that produced the replay payload. */
  readonly eventId: EventCursor
  /** JSON payload copied from the delivered event for snapshot-only replay. */
  readonly payload: JsonValue
}

/** Occurrence-keyed delivered suspend cursors retained across replay barriers. */
export interface RuntimeDeliveredSuspends {
  readonly [deliveryKey: string]: RuntimeDeliveredSuspend | undefined
}

/** Idempotency marker written atomically with completed transitions. */
export interface IdempotencyRecord {
  /** Runtime namespace. */
  readonly namespace: string
  /** Stable idempotency key. */
  readonly key: string
  /** Time when the guarded operation completed durably. */
  readonly completedAt: Date
}

/** Durable state read options. */
export interface RuntimeStateReadOptions {
  /** Runtime namespace. */
  readonly namespace: string
}

/** Input for creating a fresh pending runtime work item. */
export interface NewWorkItem {
  /** Kernel-minted stable work id. */
  readonly workId: WorkId
  /** Runtime namespace. */
  readonly namespace: string
  /** Small routing payload describing the work to execute. */
  readonly work: RuntimeWork
  /** Name-based runtime target id. */
  readonly targetId: RuntimeTargetId
  /** Stable idempotency key for the first delivery. */
  readonly idempotencyKey: string
  /** Earliest time this work should be delivered. */
  readonly notBefore?: Date
  /** Attempts allowed before dead-letter. Defaults to the engine default. */
  readonly maxAttempts?: number
  /** Timestamp override for deterministic tests. Defaults to now. */
  readonly now?: Date
  /** Scoped-idle counter group this work keeps busy until terminal. */
  readonly idleScope?: string
}

/** Options for moving an existing suspended item back to pending. */
export interface SetWorkPendingOptions extends RuntimeStateReadOptions {
  /** Work payload to carry on the fresh delivery intent. */
  readonly work: RuntimeWork
  /** Stable idempotency key for the fresh delivery intent. */
  readonly idempotencyKey: string
  /**
   * Current statuses that may be moved back to pending.
   *
   * Defaults to `suspended`, which is the flow waiter/timer resume path.
   * Operator retry uses `blocked` and `dead-letter` through the same store CAS.
   */
  readonly from?: WorkStatus | readonly WorkStatus[]
}

/** Delivered event metadata to attach to a pending suspend by waiter id. */
export interface MarkSnapshotDeliveredOptions extends RuntimeStateReadOptions {
  /** Waiter that won the event/timeout race. */
  readonly waiterId: WaiterId
  /** Durable event cursor that produced the delivered payload. */
  readonly eventId: EventCursor
  /** JSON payload copied into the snapshot for future replay. */
  readonly payload: JsonValue
}

/** Bounded work-listing options used by kernel-owned maintenance. */
export interface ListWorkOptions {
  /** Runtime namespace to list within. */
  readonly namespace: string
  /** Work status to list. */
  readonly status: WorkStatus
  /** Only include records updated before this time. */
  readonly updatedBefore?: Date
  /** Maximum number of records to return. */
  readonly limit?: number
}

/** Grouped work-count query used by operator status surfaces. */
export interface CountWorkOptions {
  /** Runtime namespace to count within. */
  readonly namespace: string
}

/** Count of work rows grouped by status and target. */
export interface WorkStatusCount {
  /** Runtime namespace for this count bucket. */
  readonly namespace: string
  /** Work status for this count bucket. */
  readonly status: WorkStatus
  /** Runtime target id for this count bucket. */
  readonly targetId: RuntimeTargetId
  /** Number of rows in this bucket. */
  readonly count: number
  /** True when an adapter hit a bounded-read cap before proving the exact count. */
  readonly truncated?: boolean
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
  createWork(work: NewWorkItem): Promise<WorkItem>

  /**
   * Load a work item by id.
   *
   * Reads may happen concurrently with wake delivery. The kernel treats
   * terminal work as idempotent duplicate delivery.
   */
  getWork(
    workId: WorkId,
    options: RuntimeStateReadOptions,
  ): Promise<WorkItem | null>

  /**
   * Persist a work item produced by the kernel state machine.
   *
   * Adapters must not perform their own status transitions or retry decisions.
   */
  putWork(work: WorkItem): Promise<void>

  /**
   * List bounded work records for kernel-owned maintenance.
   *
   * Adapters only filter and return records; expiry-vs-failure decisions,
   * cancellation legality, retry, and retention policy stay in the kernel.
   */
  listWork(options: ListWorkOptions): Promise<readonly WorkItem[]>

  /**
   * Count work records for operator/devtools status without sampling rows.
   *
   * SQL-style adapters should return exact grouped counts. Bounded platforms may
   * set `truncated` when they hit a platform read cap before proving the exact
   * count, so callers never mistake a capped sample for an exact total.
   */
  countWork(options: CountWorkOptions): Promise<readonly WorkStatusCount[]>

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
  ): Promise<WorkItem | null>

  /**
   * Load a flow snapshot by id.
   *
   * Snapshot ids are generated by flow handles; runtime-backed replay reads
   * them through this port instead of the object-bound record-store path.
   */
  getSnapshot(
    flowId: FlowId,
    options: RuntimeStateReadOptions,
  ): Promise<FlowSnapshot | null>

  /**
   * Persist a runtime-backed flow snapshot.
   *
   * Snapshot writes participate in composite transactions in store adapters
   * that support atomic multi-record updates.
   */
  putSnapshot(snapshot: FlowSnapshot): Promise<void>

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
  ): Promise<void>

  /**
   * Check whether a stable idempotency key has already completed.
   *
   * Idempotency records are generated by the kernel and scoped by namespace.
   */
  hasIdempotencyKey(namespace: string, key: string): Promise<boolean>

  /**
   * Persist a completed idempotency record.
   *
   * Composite operations write this atomically with their state transition so a
   * crash can never record one without the other.
   */
  putIdempotencyKey(record: IdempotencyRecord): Promise<void>

  /**
   * Increment a scoped-idle counter and return the new count.
   *
   * Called from work creation transactions when a newly minted item carries an
   * idle scope. The counter represents non-terminal work in that scope.
   */
  incrementIdle(namespace: string, scope: string): Promise<number>

  /**
   * Decrement a scoped-idle counter and return the new count.
   *
   * Called by kernel terminal transitions. Implementations should reject
   * negative counts because that indicates a kernel accounting bug.
   */
  decrementIdle(namespace: string, scope: string): Promise<number>

  /**
   * Read the current scoped-idle counter.
   *
   * Used by future `untilIdle` registration to avoid lost wakeups when the
   * scope is already idle.
   */
  getIdleCount(namespace: string, scope: string): Promise<number>
}
