/** Ordered, safe Work stream events. */

import type { WorkProgressSnapshot } from "./progress";
import type { WorkStatus } from "./status";

/** Options for resuming a Work event stream. */
export interface WorkStreamOptions {
  /** Continue strictly after this opaque cursor, or replace an expired cursor with a snapshot. */
  readonly after?: string;
}

interface WorkEventBase {
  /** Stable deduplication identity for this event. */
  readonly id: string;
  /** Opaque position accepted by {@link WorkStreamOptions.after}. */
  readonly cursor: string;
  /** Work occurrence that owns this event. */
  readonly workId: string;
  /** Time the Runtime appended this safe event. */
  readonly occurredAt: Date;
}

/**
 * A deduplicable lifecycle or progress event for one Work occurrence.
 *
 * @remarks Streams carry safe snapshots only; they never contain results or
 * raw failures.
 */
export type WorkEvent =
  | (WorkEventBase & {
      readonly type: "work.snapshot";
      readonly status: WorkStatus;
    })
  | (WorkEventBase & {
      readonly type: "work.status";
      readonly status: WorkStatus;
    })
  | (WorkEventBase & {
      readonly type: "work.progress";
      readonly progress: WorkProgressSnapshot;
    });
