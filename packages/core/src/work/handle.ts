/** Public handle and admission options for finite Work. */

import type { EffectScopeRef } from "../effect";
import type { ScopeStats } from "../statistics/types";
import type { CancelOptions, CancelReceipt } from "./cancellation";
import type { DetachReceipt } from "./detachment";
import type { WorkEvent, WorkStreamOptions } from "./events";
import type { WorkProgress } from "./progress";
import type { WorkStatus } from "./status";

/** Required caller-owned identity for top-level Work acceptance. */
export interface SpawnWorkOptions {
  /** Stable idempotency key in the configured Runtime namespace. */
  readonly idempotencyKey: string;
}

/** Bounded execution statistics for one Work occurrence. */
export type ExecutionStats = ScopeStats;

/**
 * A live, result-typed reference to one finite Work occurrence.
 *
 * @typeParam TResult - Exact successful result produced by the target.
 * @remarks Handles are live control references, not serialized durable refs.
 */
export interface WorkHandle<TResult> {
  /** Stable occurrence identity. */
  readonly id: string;
  /** Stable Effect scope allocated when the Work was accepted. */
  readonly effects: EffectScopeRef;
  /** Read the latest safe lifecycle snapshot. */
  status(): Promise<WorkStatus>;
  /**
   * Wait for and return the exact successful Work result.
   *
   * @remarks The Promise observes this accepted occurrence; reconnecting the
   * same Work never starts another execution.
   * @returns The target's exact inferred output after terminal publication.
   * @throws `WorkFailedError` for a safe terminal failure.
   * @throws `WorkCancelledError` when Work terminalizes through cancellation.
   * @throws `WorkResultExpiredError` when the terminal payload is no longer retained.
   */
  result(): Promise<TResult>;
  /**
   * Replace the current bounded progress snapshot for live Work.
   *
   * @throws `WorkNotActiveError` after completion, failure, or cancellation.
   * @throws `TypeError` when the update exceeds its public safety bounds.
   */
  progress(update: WorkProgress): Promise<void>;
  /**
   * Request idempotent cooperative cancellation.
   *
   * @remarks A concurrent completion that commits first remains authoritative.
   */
  cancel(options?: CancelOptions): Promise<CancelReceipt>;
  /** Release the current owner's obligation without cancelling or waking Work. */
  detach(): Promise<DetachReceipt>;
  /**
   * Read ordered, deduplicable safe events until the terminal boundary.
   *
   * @remarks Without `after`, or when its cursor expired, the first event is a
   * replacement snapshot. Streams never contain results or raw failures.
   */
  stream(options?: WorkStreamOptions): AsyncIterable<WorkEvent>;
  /** Read the bounded owner-scoped statistics-ledger projection. */
  stats(): Promise<ExecutionStats>;
}
