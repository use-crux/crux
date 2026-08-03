/** Bounded, safe progress reporting for Work. */

/**
 * A caller-supplied progress update for live Work.
 *
 * @remarks Progress replaces the current snapshot. It never carries a result,
 * wakes an owner, or changes Work ownership.
 */
export interface WorkProgress {
  /** Human-readable safe progress summary. */
  readonly message?: string;
  /** Completed units when progress is countable. */
  readonly current?: number;
  /** Total units when known. */
  readonly total?: number;
}

/**
 * The latest accepted progress update with its publication time.
 *
 * @remarks Work exposes one current snapshot, not an unbounded progress log.
 */
export interface WorkProgressSnapshot extends WorkProgress {
  /** Time at which this snapshot replaced the previous progress update. */
  readonly updatedAt: Date;
}
