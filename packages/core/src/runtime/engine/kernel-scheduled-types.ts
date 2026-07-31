/**
 * Replay-visible work buffered by Flow execution.
 *
 * @module
 */

import type { JsonValue } from "../../storage";
import type { RuntimeTargetId, TaskId, TimerId, WorkId } from "../ports/ids";

/** Buffered replay-visible work produced by `flow.defer()` or `flow.after()`. */
export type RuntimeScheduledWorkIntent =
  | {
      /** Deferred-work discriminator. */
      readonly kind: "defer";
      /** Replay-stable operation key. */
      readonly key: string;
      /** Runtime namespace that owns the work. */
      readonly namespace: string;
      /** Name-based target id to execute. */
      readonly targetId: RuntimeTargetId;
      /** Durable task instance id. */
      readonly taskId: TaskId;
      /** Durable work item id. */
      readonly workId: WorkId;
      /** JSON input persisted with the task work item. */
      readonly input: JsonValue;
      /** Scoped-idle counter group this task keeps busy until terminal. */
      readonly idleScope: string;
    }
  | {
      /** Delayed-work discriminator. */
      readonly kind: "after";
      /** Replay-stable operation key. */
      readonly key: string;
      /** Runtime namespace that owns the work. */
      readonly namespace: string;
      /** Name-based target id to execute. */
      readonly targetId: RuntimeTargetId;
      /** Durable task instance id. */
      readonly taskId: TaskId;
      /** Earliest time the task may run. */
      readonly fireAt: Date;
      /** JSON input persisted with the task work item. */
      readonly input: JsonValue;
      /** Scoped-idle counter group this task keeps busy until terminal. */
      readonly idleScope: string;
    };

/** Committed metadata produced by flushing one durable work intent. */
export interface RuntimeScheduledWorkFlushRecord {
  /** Replay-stable operation key. */
  readonly key: string;
  /** Created work id for an immediate deferred intent. */
  readonly workId?: WorkId;
  /** Created timer id for a delayed intent. */
  readonly timerId?: TimerId;
}
