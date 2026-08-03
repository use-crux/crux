/** Ordered, safe Work stream events. */

import type { WorkProgressSnapshot } from "./progress";
import type { WorkStatus } from "./status";

/** Options for resuming a Work event stream. */
export interface WorkStreamOptions {
  /** Continue after this opaque event cursor. */
  readonly after?: string;
}

interface WorkEventBase {
  readonly id: string;
  readonly cursor: string;
  readonly workId: string;
  readonly occurredAt: Date;
}

/**
 * A deduplicable lifecycle or progress event for one Work occurrence.
 *
 * @remarks Streams carry safe snapshots only; they never contain results or
 * raw failures.
 */
export type WorkEvent =
  | (WorkEventBase & { readonly type: "work.snapshot"; readonly status: WorkStatus })
  | (WorkEventBase & { readonly type: "work.status"; readonly status: WorkStatus })
  | (WorkEventBase & {
      readonly type: "work.progress";
      readonly progress: WorkProgressSnapshot;
    });
