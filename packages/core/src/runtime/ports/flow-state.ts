/** Durable Flow snapshot and replay-delivery records. */

import type { JsonValue } from "../../storage";
import type { EffectScopeRef } from "../../effect/types";
import type {
  EventCursor,
  FlowId,
  RuntimeTargetId,
  TimerId,
  WaiterId,
  WorkId,
} from "./ids";
import type { RuntimeTargetDefinitionRef } from "./target-definition";

/** Flow snapshot shape persisted by runtime-backed Flow replay. */
export interface FlowSnapshot {
  /** Durable Flow instance id. */
  readonly flowId: FlowId;
  /** In-process Effect boundary retained across Flow execution segments. */
  readonly effects?: EffectScopeRef;
  /** Owning Runtime work item for this Flow occurrence. */
  readonly workId: WorkId;
  /** Name-based target id for the Flow definition. */
  readonly targetId: RuntimeTargetId;
  /** Exact generated definition pinned at application Work acceptance. */
  readonly definition?: RuntimeTargetDefinitionRef;
  /** Write-once terminal result obligation for application-spawned Flow Work. */
  readonly resultObligation?: { readonly kind: "required" };
  /** Runtime namespace. */
  readonly namespace: string;
  /** Flow lifecycle status. */
  readonly status:
    | "running"
    | "suspended"
    | "completed"
    | "blocked"
    | "expired"
    | "cancelled";
  /** JSON input captured at first run. */
  readonly input: JsonValue;
  /** Serializable observability carrier for the next execution segment. */
  readonly continuation?: JsonValue;
  /** Existing label-keyed step cache, unchanged by the Runtime Engine. */
  readonly completedSteps: Readonly<Record<string, JsonValue>>;
  /** Ordered replay-structure labels observed so far. */
  readonly fingerprint: readonly string[];
  /** Suspensions currently owned by this snapshot. */
  readonly pendingSuspends: readonly RuntimePendingSuspend[];
  /** Occurrence-keyed deliveries already consumed by replay. */
  readonly deliveredSuspends?: RuntimeDeliveredSuspends;
  /** Durable work already flushed for replay-visible defer/after calls. */
  readonly scheduledWork?: Readonly<Record<string, RuntimeScheduledWork>>;
  /** Last update time. */
  readonly updatedAt: Date;
}

/** Committed replay-visible scheduled-work metadata. */
export interface RuntimeScheduledWork {
  /** Child work id for `flow.defer()` work. */
  readonly workId?: WorkId;
  /** Timer id for `flow.after()` work. */
  readonly timerId?: TimerId;
}

/** Suspension metadata stored with a Flow snapshot. */
export interface RuntimePendingSuspend {
  /** User-authored suspend/wait label. */
  readonly label: string;
  /** Source-order replay key for disambiguating repeated labels. */
  readonly deliveryKey?: string;
  /** Waiter registered for event/Signal delivery. */
  readonly waiterId?: WaiterId;
  /** Timer registered for timeout delivery. */
  readonly timerId?: TimerId;
  /** Absolute deadline for timeout replay. */
  readonly timeoutAt?: Date;
  /** Whether deployed predicate code filters durable candidates. */
  readonly signalPredicate?: true;
  /** FIFO Signal occurrences awaiting predicate evaluation. */
  readonly candidates?: readonly RuntimeDeliveredSuspend[];
  /** Event delivery selected for this suspend point. */
  readonly delivered?: RuntimeDeliveredSuspend;
}

/** Delivered event metadata recorded for snapshot-only replay. */
export interface RuntimeDeliveredSuspend {
  /** Durable event cursor that produced the replay payload. */
  readonly eventId: EventCursor;
  /** JSON payload copied from the delivered event. */
  readonly payload: JsonValue;
}

/** Occurrence-keyed delivered suspend records retained across replay barriers. */
export interface RuntimeDeliveredSuspends {
  readonly [deliveryKey: string]: RuntimeDeliveredSuspend | undefined;
}
