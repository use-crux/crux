/**
 * Runtime kernel public operation types.
 *
 * These types keep the kernel factory small while preserving a stable surface
 * for hand-written runtime entries, generated handlers, and conformance tests.
 *
 * @module
 */

import type { JsonValue } from "../../storage";
import type { RuntimeEvent } from "../ports/events";
import type { Lease } from "../ports/leases";
import type { FlowSnapshot as RuntimeFlowSnapshot } from "../ports/state";
import type { RuntimeTargetId, TaskId, WorkId } from "../ports/ids";
import type {
  RuntimeOutboxItem,
  RuntimeStoreAdapter,
  RuntimeTimerRecord,
} from "../store";
import type { RuntimeRetentionConfig } from "./retention";
import type { RuntimeProgram } from "../program";
import type { WakeEnvelope } from "./envelope";
import type { RuntimeWorkItem, WorkItemError } from "./work";
import type { RuntimeDeferredIntent } from "../ports/deferred";
import type { RuntimeResultRef } from "../results/types";
import type {
  AbandonDeferredScopeInput,
  DeferredScopeTransitionResult,
  FinalizeDeferredScopeInput,
  RenewDeferredScopeLeaseInput,
  RenewDeferredScopeLeaseResult,
  StageDeferredIntentInput,
} from "./kernel-deferred";
import type {
  SignalPublishCompositeInput,
  SignalPublishCompositeResult,
} from "./composites/signal";
import type {
  RecordSuspensionInput,
  RuntimeSuspensionSnapshotInput,
} from "./kernel-flow-types";
import type { FlowManualResumeInput } from "./composites/flow-manual-resume";
import type {
  RuntimeScheduledWorkFlushRecord,
  RuntimeScheduledWorkIntent,
} from "./kernel-scheduled-types";
import type {
  MaintenanceTickOptions,
  MaintenanceTickResult,
  ScanTimersOptions,
  ScanTimersResult,
  ScheduleTimerInput,
} from "./kernel-timer-types";

export type { RuntimeSuspendRegistration } from "./kernel-suspension-types";
export type {
  RecordSuspensionInput,
  RuntimeSuspensionSnapshotInput,
} from "./kernel-flow-types";
export type {
  RuntimeScheduledWorkFlushRecord,
  RuntimeScheduledWorkIntent,
} from "./kernel-scheduled-types";
export type {
  FireTimerRecordResult,
  MaintenanceTickOptions,
  MaintenanceTickResult,
  ScanTimersOptions,
  ScanTimersResult,
  ScheduleTimerInput,
} from "./kernel-timer-types";

/** Result returned by a runtime target execution. */
export type RuntimeTargetOutcome =
  | { readonly status: "completed"; readonly resultRef?: RuntimeResultRef }
  | {
      readonly status: "completed";
      readonly resultRef?: RuntimeResultRef;
      /** Flow snapshot status to persist atomically with completed flow work. */
      readonly flowSnapshot: RuntimeFlowSnapshot;
      /** Replay-visible durable work to flush with flow completion. */
      readonly scheduledWork?: readonly RuntimeScheduledWorkIntent[];
    }
  | {
      readonly status: "cancelled";
      /** Flow snapshot status to persist atomically with cancelled flow work. */
      readonly flowSnapshot: RuntimeFlowSnapshot;
      /** Replay-visible durable work to flush with flow cancellation. */
      readonly scheduledWork?: readonly RuntimeScheduledWorkIntent[];
    }
  | {
      readonly status: "suspended";
      /** Flow suspension snapshot and waiter registrations to commit. */
      readonly suspension: RecordSuspensionInput;
    }
  | { readonly status: "blocked"; readonly error: WorkItemError };

/** Execution context passed to a runtime target. */
export interface RuntimeTargetContext {
  /** Leased work item being processed. */
  readonly work: RuntimeWorkItem;
  /** Lease proving this kernel owns the work item for this attempt. */
  readonly lease: Lease;
}

/** Runtime target entry supplied by hand-written or generated handlers. */
export interface RuntimeTarget {
  /** Durable target id from `flow("name")` or `durableTask("name")`. */
  readonly targetId: RuntimeTargetId;
  /** Target kind used for diagnostics and future flow replay routing. */
  readonly kind: "flow" | "task";
  /** Execute the target and return the durable outcome to commit. */
  execute(context: RuntimeTargetContext): Promise<RuntimeTargetOutcome>;
}

/** Map of target names to executable runtime targets. */
export type RuntimeTargetMap = Readonly<Record<string, RuntimeTarget>>;

/** Schedule repeated lease heartbeat attempts and return a cancel function. */
export type RuntimeLeaseExtensionSchedule = (
  fn: () => void,
  intervalMs: number,
) => () => void;

/** Options for extending a wake lease while a target is executing. */
export interface RuntimeLeaseExtensionOptions {
  /** Heartbeat interval. Defaults to one third of the lease TTL. */
  readonly intervalMs?: number;
  /** Scheduler used by tests and hosts that need custom interval mechanics. */
  readonly schedule?: RuntimeLeaseExtensionSchedule;
}

/** Options for constructing a runtime kernel. */
export interface RuntimeKernelOptions {
  /** Durable store used for state, events, waiters, timers, outbox, and leases. */
  readonly store: RuntimeStoreAdapter;
  /** Runtime targets available to wake delivery. */
  readonly targets: RuntimeTargetMap;
  /** Immutable authored target program available during execution. */
  readonly program?: RuntimeProgram;
  /** Verify a wake envelope before any durable writes. Defaults to accept. */
  readonly verifyWake?: (envelope: WakeEnvelope) => boolean | Promise<boolean>;
  /** Work id generator owned by the kernel. */
  readonly newWorkId: () => WorkId;
  /** Current time source for deterministic tests. */
  readonly now?: () => Date;
  /** Lease TTL for wake processing. Defaults to 60 seconds. */
  readonly leaseTtlMs?: number;
  /** Extend the wake lease while target code runs. Pass `false` to disable. */
  readonly leaseExtension?: false | RuntimeLeaseExtensionOptions;
  /** Retry jitter source for deterministic tests. */
  readonly rng?: () => number;
  /** Retention policy for terminal runtime records. Defaults are production-safe. */
  readonly retention?: RuntimeRetentionConfig;
  /** Longest wake delay/redelivery horizon known to the composer. */
  readonly redeliveryHorizonMs?: number;
}

/** Input for enqueuing task work. */
export interface EnqueueTaskInput {
  /** Runtime namespace that owns the work. */
  readonly namespace: string;
  /** Durable task instance id. */
  readonly taskId: TaskId;
  /** Name-based target id to execute. */
  readonly targetId: RuntimeTargetId;
  /** Earliest time the task may run. */
  readonly notBefore?: Date;
  /** Scoped-idle counter group this task keeps busy until terminal. */
  readonly idleScope?: string;
  /** JSON input persisted with the task work item. */
  readonly input?: JsonValue;
}

/** Input for appending an event and firing matching waiters. */
export interface EmitEventInput {
  /** Runtime namespace. */
  readonly namespace: string;
  /** Durable event name. */
  readonly name: string;
  /** JSON event payload. */
  readonly payload: JsonValue;
  /** Optional event id for duplicate append idempotency. */
  readonly eventId?: string;
}

/** Result of appending an event through the kernel. */
export interface EmitEventResult {
  /** Durable event that was appended or deduplicated. */
  readonly event: RuntimeEvent;
  /** Wake outbox rows produced for waiters that won the race. */
  readonly outboxItems: readonly RuntimeOutboxItem[];
}

/** Input for cancelling durable runtime work. */
export interface CancelWorkInput {
  /** Runtime namespace. */
  readonly namespace: string;
  /** Work item to cancel. */
  readonly workId: WorkId;
}

/** Result of an idempotent cancellation attempt. */
export interface CancelWorkResult {
  /** Whether this call moved a non-terminal work item to cancelled. */
  readonly cancelled: boolean;
}

/** Input for operator retry of blocked or dead-lettered runtime work. */
export interface RetryWorkInput {
  /** Runtime namespace. */
  readonly namespace: string;
  /** Work item to retry. */
  readonly workId: WorkId;
}

/** Result of an idempotent operator retry attempt. */
export type RetryWorkResult =
  | {
      /** Whether this call moved retryable terminal work to pending. */
      readonly retried: true;
      /** Fresh pending work record carrying the operator retry idempotency key. */
      readonly work: RuntimeWorkItem;
    }
  | {
      /** False when the work is missing or not in a retryable terminal state. */
      readonly retried: false;
    };

/** Outcome of a wake handling attempt. */
export type RuntimeWakeResult =
  | {
      readonly status: 200;
      readonly outcome:
        | "processed"
        | "duplicate"
        | "stale"
        | "blocked"
        | "retry-scheduled"
        | "dead-lettered"
        | "lease-lost";
    }
  | { readonly status: 401; readonly outcome: "unverified" }
  | { readonly status: 409; readonly outcome: "busy" };

/** Runtime kernel operations for durable work and wake handling. */
export interface RuntimeKernel {
  /** Atomically arbitrate a manual Flow resume with its waiter and timer. */
  resumeFlow(input: FlowManualResumeInput): Promise<RuntimeWorkItem | null>;
  /** Atomically accept one Signal occurrence and every required delivery. */
  publishSignal(
    input: SignalPublishCompositeInput,
  ): Promise<SignalPublishCompositeResult>;
  /** Durably accept named deferred work without making it runnable. */
  stageDeferredIntent(
    input: StageDeferredIntentInput,
  ): Promise<RuntimeDeferredIntent>;
  /** Atomically finalize an invocation and release all staged siblings. */
  finalizeDeferredScope(
    input: FinalizeDeferredScopeInput,
  ): Promise<DeferredScopeTransitionResult>;
  /** Atomically abandon an unfinalized invocation and all staged siblings. */
  abandonDeferredScope(
    input: AbandonDeferredScopeInput,
  ): Promise<DeferredScopeTransitionResult>;
  /** Renew or fence the durable deferred scope lease token/expiry. */
  renewDeferredScopeLease(
    input: RenewDeferredScopeLeaseInput,
  ): Promise<RenewDeferredScopeLeaseResult>;
  /** Create pending task work and write its wake envelope to the outbox. */
  enqueueTask(input: EnqueueTaskInput): Promise<RuntimeWorkItem>;
  /** Persist a flow suspension and owned waiter registrations atomically. */
  recordSuspension(input: RecordSuspensionInput): Promise<void>;
  /** Append an event and resume all matching waiters that win the CAS race. */
  emitEvent(input: EmitEventInput): Promise<EmitEventResult>;
  /** Cancel non-terminal work and its owned waiter/timer registrations. */
  cancelWork(input: CancelWorkInput): Promise<CancelWorkResult>;
  /** Retry blocked or dead-lettered work after an operator believes the cause is fixed. */
  retryWork(input: RetryWorkInput): Promise<RetryWorkResult>;
  /** Persist a store-backed timer record. */
  scheduleTimer(input: ScheduleTimerInput): Promise<RuntimeTimerRecord>;
  /** Fire due store-backed timers through the waiter CAS race gate. */
  scanTimers(options?: ScanTimersOptions): Promise<ScanTimersResult>;
  /** Run one kernel-owned maintenance pass. */
  maintenanceTick(
    options?: MaintenanceTickOptions,
  ): Promise<MaintenanceTickResult>;
  /** Handle one verified wake envelope through lease, execution, and commit. */
  handleWake(envelope: WakeEnvelope): Promise<RuntimeWakeResult>;
}
