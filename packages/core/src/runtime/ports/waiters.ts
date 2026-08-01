/**
 * Durable waiter port contract.
 *
 * Waiters correlate future events to suspended work without scanning event
 * history. Adapters must resolve only armed waiters, use top-level JSON key
 * equality for matches, and support concurrent event/timeout races through one
 * winning transition.
 *
 * @module
 */

import type { JsonValue } from "../../storage";
import type { TimerId, WaiterId, WorkId } from "./ids";
import type { RuntimeWork } from "./work";

/** New waiter registration. */
export interface NewRuntimeWaiter {
  /** Runtime namespace that owns this waiter. */
  readonly namespace: string;
  /** Event name this waiter listens for. */
  readonly eventName: string;
  /** Static Signal identity when this waiter participates in durable publication. */
  readonly source?: {
    readonly kind: "signal";
    readonly signalId: string;
    readonly match?: JsonValue;
    /** Deployed predicate code evaluates queued candidates during Flow replay. */
    readonly filterKind?: "predicate";
  };
  /** Top-level payload equality match. */
  readonly match: Readonly<Record<string, JsonValue>>;
  /** Owning suspended work item; absent means firing mints new work. */
  readonly workId?: WorkId;
  /** Work payload used when this waiter fires or creates a new item. */
  readonly work: RuntimeWork;
  /** Optional timeout deadline. */
  readonly timeoutAt?: Date;
}

/** Durable waiter record. */
export interface RuntimeWaiter extends NewRuntimeWaiter {
  /** Adapter-generated waiter id. */
  readonly waiterId: WaiterId;
  /** Timer linked to this waiter, when timeout delivery is scheduled separately. */
  readonly timerId?: TimerId;
  /** Current race state. Only one transition may win from `armed`. */
  readonly state: "armed" | "fired" | "timed-out" | "cancelled";
}

/** Optional namespace scoping for waiter resolution. */
export interface ResolveWaiterOptions {
  /** Runtime namespace to resolve within. */
  readonly namespace?: string;
}

/** Durable waiter registration and correlation port. */
export interface WaiterPort {
  /**
   * Persist a waiter before the owning suspension commits.
   *
   * The caller may register waiters concurrently for independent work items.
   * Adapter-generated waiter ids must be stable after the method resolves.
   */
  register(waiter: NewRuntimeWaiter): Promise<RuntimeWaiter>;

  /**
   * Resolve armed waiters for an event payload.
   *
   * Implementations must be idempotent under duplicate event appends and must
   * not fire waiters that a timeout already moved out of `armed`.
   */
  resolve(
    eventName: string,
    payload: JsonValue,
    options?: ResolveWaiterOptions,
  ): Promise<readonly RuntimeWaiter[]>;

  /**
   * Cancel an armed waiter.
   *
   * Cancellation is idempotent. Cancelling a fired, timed-out, or already
   * cancelled waiter is a no-op.
   */
  cancel(waiterId: WaiterId): Promise<void>;
}
