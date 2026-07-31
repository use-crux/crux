/**
 * Runtime store adapter contract.
 *
 * Store adapters persist the Runtime Engine's durable records and expose a
 * transaction scope for the few kernel operations that must commit multiple
 * records atomically. Wake delivery stays outside this contract and is routed
 * through outbox records.
 *
 * @module
 */

import type { WakeEnvelope } from "./engine/envelope";
import type {
  RuntimeCompositeInput,
  RuntimeCompositeKind,
  RuntimeCompositeResult,
} from "./engine/composites";
import type { DurableEventPort } from "./ports/events";
import type { RuntimeDeferredStorePort } from "./ports/deferred";
import type { LeasePort } from "./ports/leases";
import type { TimerId, WaiterId, WorkId } from "./ports/ids";
import type { RuntimeStatePort } from "./ports/state";
import type { RuntimeWork } from "./ports/work";
import type { RuntimeWaiter, WaiterPort } from "./ports/waiters";
import type {
  RuntimePruneOptions,
  RuntimePruneResult,
} from "./ports/retention";
import type { RuntimeResultPayloadPort } from "./results/types";
import type { RuntimeSignalStorePort } from "./reactive/records";

/** Timer record lifecycle stored by a runtime store adapter. */
export type RuntimeTimerState = "scheduled" | "fired" | "cancelled";

/** Outbox lifecycle stored by a runtime store adapter. */
export type RuntimeOutboxState = "pending" | "dispatched" | "confirmed";

/** Timer record input accepted by {@link RuntimeTimerStorePort.put}. */
export interface NewRuntimeTimerRecord {
  /** Runtime namespace that owns this timer. */
  readonly namespace: string;
  /** Deadline when the timer becomes eligible to fire. */
  readonly fireAt: Date;
  /** Owning suspended work item; absent means firing mints new work. */
  readonly workId?: WorkId;
  /** Linked waiter whose timeout race must be resolved when this timer fires. */
  readonly waiterId?: WaiterId;
  /** Scoped-idle counter group to stamp onto work minted by this timer. */
  readonly idleScope?: string;
  /** Work to enqueue when the timer fires. */
  readonly work: RuntimeWork;
  /** Optional stable duplicate scheduling key. */
  readonly idempotencyKey?: string;
}

/** Durable timer record stored by a runtime store adapter. */
export interface RuntimeTimerRecord extends NewRuntimeTimerRecord {
  /** Adapter-generated timer id. */
  readonly timerId: TimerId;
  /** Current timer race state. */
  readonly state: RuntimeTimerState;
}

/** Options for claiming due timer records. */
export interface ClaimDueTimersOptions {
  /** Namespace to scan. Omit only for maintenance diagnostics. */
  readonly namespace?: string;
  /** Time used to decide whether a timer is due. */
  readonly now: Date;
  /** Maximum number of timers to return. */
  readonly limit?: number;
}

/** Bounded timer listing options for operator/devtools inspection. */
export interface ListTimerRecordsOptions {
  /** Namespace to list within. */
  readonly namespace: string;
  /** Current timer state to include. Omit to include every state. */
  readonly state?: RuntimeTimerState;
  /** Maximum number of timers to return. */
  readonly limit?: number;
}

/** Store-backed timer record operations used by the kernel. */
export interface RuntimeTimerStorePort {
  /** Persist a scheduled timer record idempotently. */
  put(timer: NewRuntimeTimerRecord): Promise<RuntimeTimerRecord>;
  /** Load a timer record by id. */
  get(timerId: TimerId): Promise<RuntimeTimerRecord | null>;
  /** Claim due scheduled timers for a scanner pass. */
  claimDue(
    options: ClaimDueTimersOptions,
  ): Promise<readonly RuntimeTimerRecord[]>;
  /** List bounded timer records for operator/devtools inspection. */
  list(
    options: ListTimerRecordsOptions,
  ): Promise<readonly RuntimeTimerRecord[]>;
  /** List timer records owned by one work item for cancellation and retention. */
  listByWork(workId: WorkId): Promise<readonly RuntimeTimerRecord[]>;
  /** Move a timer through one compare-and-set transition. */
  transition(
    timerId: TimerId,
    from: RuntimeTimerState,
    to: RuntimeTimerState,
  ): Promise<boolean>;
  /** Delete a bounded batch of fired or cancelled timers before a cutoff. */
  prune(options: RuntimePruneOptions): Promise<RuntimePruneResult>;
}

/** Runtime outbox row written inside a store transaction. */
export interface RuntimeOutboxItem {
  /** Adapter-generated outbox id. */
  readonly outboxId: string;
  /** Runtime namespace carried by the wake envelope. */
  readonly namespace: string;
  /** Small wake envelope to deliver after commit. */
  readonly envelope: WakeEnvelope;
  /** Current dispatch state. */
  readonly state: RuntimeOutboxState;
  /** Number of delivery attempts claimed by a dispatcher. */
  readonly attempts: number;
  /** Earliest time the item can be claimed again. */
  readonly nextAttemptAt: Date;
}

/** Options for persisting a runtime outbox row. */
export interface PutOutboxOptions {
  /** Earliest time the outbox row may be claimed for delivery. Defaults to now. */
  readonly deliverAt?: Date;
}

/** Options for claiming outbox rows. */
export interface ClaimOutboxOptions {
  /** Namespace to claim. Omit only for maintenance diagnostics. */
  readonly namespace?: string;
  /** Current time for retry eligibility. */
  readonly now: Date;
  /** Maximum number of rows to claim. */
  readonly limit?: number;
}

/** Bounded outbox listing options for operator/devtools inspection. */
export interface ListOutboxOptions {
  /** Namespace to list within. */
  readonly namespace: string;
  /** Current outbox state to include. Omit to include every state. */
  readonly state?: RuntimeOutboxState;
  /** Maximum number of rows to return. */
  readonly limit?: number;
}

/** Bounded outbox listing options for one owning work item. */
export interface ListOutboxByWorkOptions {
  /** Namespace to filter within. Omit only for namespace-agnostic inspection. */
  readonly namespace?: string;
  /** Current outbox state to include. Omit to include every state. */
  readonly state?: RuntimeOutboxState;
  /** Maximum number of rows to return. */
  readonly limit?: number;
}

/** Store-backed outbox operations used by dispatchers and maintenance. */
export interface RuntimeOutboxPort {
  /** Persist a wake envelope for delivery after the surrounding transaction commits. */
  put(
    envelope: WakeEnvelope,
    options?: PutOutboxOptions,
  ): Promise<RuntimeOutboxItem>;
  /** Load an outbox item by id. */
  get(outboxId: string): Promise<RuntimeOutboxItem | null>;
  /** Claim pending or unconfirmed eligible rows for delivery. */
  claimPending(
    options: ClaimOutboxOptions,
  ): Promise<readonly RuntimeOutboxItem[]>;
  /** List bounded outbox rows for operator/devtools inspection. */
  list(options: ListOutboxOptions): Promise<readonly RuntimeOutboxItem[]>;
  /** List bounded outbox rows owned by one work item. */
  listByWork(
    workId: WorkId,
    options?: ListOutboxByWorkOptions,
  ): Promise<readonly RuntimeOutboxItem[]>;
  /** Mark a delivered row confirmed. */
  confirm(outboxId: string): Promise<void>;
  /** Requeue a row after a delivery failure. */
  retryLater(outboxId: string, nextAttemptAt: Date): Promise<void>;
  /** Delete a bounded batch of confirmed outbox rows before a cutoff. */
  prune(options: RuntimePruneOptions): Promise<RuntimePruneResult>;
}

/** Waiter store operations needed in addition to the public waiter port. */
export interface RuntimeWaiterStorePort extends WaiterPort {
  /** Attach a timeout timer after both waiter and timer ids exist in a transaction. */
  attachTimer(waiterId: WaiterId, timerId: TimerId): Promise<void>;
  /** List waiter records owned by one work item for cancellation and retention. */
  listByWork(workId: WorkId): Promise<readonly RuntimeWaiter[]>;
  /** Claim armed waiters whose timeout passed when no native timer fired them. */
  claimExpired(
    options: ClaimExpiredWaitersOptions,
  ): Promise<readonly RuntimeWaiter[]>;
  /** Move a waiter through one compare-and-set race transition. */
  transition(
    waiterId: RuntimeWaiter["waiterId"],
    from: RuntimeWaiter["state"],
    to: RuntimeWaiter["state"],
  ): Promise<boolean>;
  /** Delete a bounded batch of resolved, timed-out, or cancelled waiters. */
  prune(options: RuntimePruneOptions): Promise<RuntimePruneResult>;
}

/** Options for claiming expired waiter registrations. */
export interface ClaimExpiredWaitersOptions {
  /** Namespace to scan. Omit only for maintenance diagnostics. */
  readonly namespace?: string;
  /** Current time for timeout eligibility. */
  readonly now: Date;
  /** Maximum number of waiters to return. */
  readonly limit?: number;
}

/** Transaction-bound view of a runtime store. */
export interface RuntimeStoreTransaction {
  readonly state: RuntimeStatePort;
  readonly events: DurableEventPort;
  readonly waiters: RuntimeWaiterStorePort;
  readonly timers: RuntimeTimerStorePort;
  readonly outbox: RuntimeOutboxPort;
  /** Durable invocation scopes and their staged named work. */
  readonly deferred: RuntimeDeferredStorePort;
  /**
   * Optional durable Signal occurrence, delivery, and subscription storage.
   *
   * @remarks Existing adapters may omit this port. Durable Signal profiles
   * then fail capability preflight before allocating Flow work.
   */
  readonly signals?: RuntimeSignalStorePort;
}

/** Durable record store used by Runtime Engine kernels. */
export interface RuntimeStoreAdapter extends RuntimeStoreTransaction {
  /** Stable adapter id used in conformance output. */
  readonly id: string;
  /**
   * Whether records survive process loss on the configured substrate.
   *
   * @remarks Omission is treated as unproven by durable reactive profiles so
   * existing adapters remain source-compatible without gaining new guarantees.
   */
  readonly durability?: "durable" | "process-local";
  /** Durable leases for concurrent workers. */
  readonly leases: LeasePort;
  /** Optional private content-addressed result storage capability. */
  readonly results?: RuntimeResultPayloadPort;
  /**
   * Run one named kernel composite as an adapter-native atomic operation.
   *
   * Adapters can omit this method to use the core default, which wraps the
   * kernel-owned composite body in {@link RuntimeStoreAdapter.transact}.
   */
  runComposite?<K extends RuntimeCompositeKind>(
    kind: K,
    input: RuntimeCompositeInput[K],
  ): Promise<RuntimeCompositeResult[K]>;
  /** Run a function against an atomic transaction scope. */
  transact<T>(fn: (tx: RuntimeStoreTransaction) => Promise<T>): Promise<T>;
}
