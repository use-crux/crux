/**
 * Flow suspension inputs committed by the runtime kernel.
 *
 * @module
 */

import type { JsonValue } from "../../storage";
import type { EffectScopeRef } from "../../effect/types";
import type { FlowId, RuntimeTargetId, WorkId } from "../ports/ids";
import type { FlowSnapshot as RuntimeFlowSnapshot } from "../ports/state";
import type { RuntimeScheduledWorkIntent } from "./kernel-scheduled-types";
import type { RuntimeSuspendRegistration } from "./kernel-suspension-types";

/** Snapshot data supplied when a Flow parks on a durable wait. */
export interface RuntimeSuspensionSnapshotInput {
  /** Original Flow input. */
  readonly input: JsonValue;
  /** In-process Effect boundary retained across Flow execution segments. */
  readonly effects?: EffectScopeRef;
  /** Existing label-keyed step cache. */
  readonly completedSteps: Readonly<Record<string, JsonValue>>;
  /** Serializable observability carrier for the next execution segment. */
  readonly continuation?: JsonValue;
  /** Ordered replay labels observed so far. */
  readonly fingerprint: readonly string[];
  /** Event cursors for already consumed suspend deliveries. */
  readonly deliveredSuspends?: RuntimeFlowSnapshot["deliveredSuspends"];
  /** Durable work already flushed in prior replay passes. */
  readonly scheduledWork?: RuntimeFlowSnapshot["scheduledWork"];
}

/** Input for atomically recording a Flow suspension and its waiters. */
export interface RecordSuspensionInput {
  /** Runtime namespace. */
  readonly namespace: string;
  /** Owning work item for the Flow occurrence. */
  readonly workId: WorkId;
  /** Durable Flow id. */
  readonly flowId: FlowId;
  /** Flow target id. */
  readonly targetId: RuntimeTargetId;
  /** Snapshot payload to persist. */
  readonly snapshot: RuntimeSuspensionSnapshotInput;
  /** Waiters to register before the suspension commits. */
  readonly suspends: readonly RuntimeSuspendRegistration[];
  /** Replay-visible durable work to flush with this suspension. */
  readonly scheduledWork?: readonly RuntimeScheduledWorkIntent[];
}
