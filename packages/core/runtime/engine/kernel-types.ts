/**
 * Runtime kernel public operation types.
 *
 * These types keep the kernel factory small while preserving a stable surface
 * for hand-written runtime entries, generated handlers, and conformance tests.
 *
 * @module
 */

import type { JsonValue } from '../../storage'
import type { RuntimeEvent } from '../ports/events'
import type { Lease } from '../ports/leases'
import type {
  FlowId,
  RuntimeTargetId,
  TaskId,
  WaiterId,
  WorkId,
} from '../ports/ids'
import type { RuntimeWork } from '../ports/work'
import type {
  RuntimeOutboxItem,
  RuntimeStoreAdapter,
  RuntimeTimerRecord,
} from '../store'
import type { WakeEnvelope } from './envelope'
import type { RuntimeWakeDeliver } from './outbox'
import type { WorkItem, WorkItemError } from './work'

/** Result returned by a runtime target execution. */
export type RuntimeTargetOutcome =
  | { readonly status: 'completed' }
  | { readonly status: 'blocked'; readonly error: WorkItemError }

/** Execution context passed to a runtime target. */
export interface RuntimeTargetContext {
  /** Leased work item being processed. */
  readonly work: WorkItem
  /** Lease proving this kernel owns the work item for this attempt. */
  readonly lease: Lease
}

/** Runtime target entry supplied by hand-written or generated handlers. */
export interface RuntimeTarget {
  /** Durable target id from `flow("name")` or future `task("name")`. */
  readonly targetId: RuntimeTargetId
  /** Target kind used for diagnostics and future flow replay routing. */
  readonly kind: 'flow' | 'task'
  /** Execute the target and return the durable outcome to commit. */
  execute(context: RuntimeTargetContext): Promise<RuntimeTargetOutcome>
}

/** Map of target names to executable runtime targets. */
export type RuntimeTargetMap = Readonly<Record<string, RuntimeTarget>>

/** Options for constructing a runtime kernel. */
export interface RuntimeKernelOptions {
  /** Durable store used for state, events, waiters, timers, outbox, and leases. */
  readonly store: RuntimeStoreAdapter
  /** Runtime targets available to wake delivery. */
  readonly targets: RuntimeTargetMap
  /** Verify a wake envelope before any durable writes. Defaults to accept. */
  readonly verifyWake?: (envelope: WakeEnvelope) => boolean | Promise<boolean>
  /** Work id generator owned by the kernel. */
  readonly newWorkId: () => WorkId
  /** Current time source for deterministic tests. */
  readonly now?: () => Date
  /** Lease TTL for wake processing. Defaults to 60 seconds. */
  readonly leaseTtlMs?: number
  /** Retry jitter source for deterministic tests. */
  readonly rng?: () => number
}

/** Input for enqueuing task work. */
export interface EnqueueTaskInput {
  /** Runtime namespace that owns the work. */
  readonly namespace: string
  /** Durable task instance id. */
  readonly taskId: TaskId
  /** Name-based target id to execute. */
  readonly targetId: RuntimeTargetId
  /** Earliest time the task may run. */
  readonly notBefore?: Date
  /** Scoped-idle counter group this task keeps busy until terminal. */
  readonly idleScope?: string
}

/** One suspend/wait registration produced by replay. */
export interface RuntimeSuspendRegistration {
  /** User-authored suspend/wait label. */
  readonly label: string
  /** Event name that can resume this suspend point. */
  readonly eventName: string
  /** Top-level payload equality match for this waiter. */
  readonly match: Readonly<Record<string, JsonValue>>
  /** Optional timeout deadline that should resume the work with flow.timeout. */
  readonly timeoutAt?: Date
}

/** Snapshot data supplied when a flow parks on suspend/wait. */
export interface RuntimeSuspensionSnapshotInput {
  /** Original flow input. */
  readonly input: JsonValue
  /** Existing label-keyed step cache. */
  readonly completedSteps: Readonly<Record<string, JsonValue>>
  /** Ordered replay labels observed so far. */
  readonly fingerprint: readonly string[]
}

/** Input for recording a flow suspension. */
export interface RecordSuspensionInput {
  /** Runtime namespace. */
  readonly namespace: string
  /** Owning work item for the flow occurrence. */
  readonly workId: WorkId
  /** Durable flow id. */
  readonly flowId: FlowId
  /** Flow target id. */
  readonly targetId: RuntimeTargetId
  /** Snapshot payload to persist. */
  readonly snapshot: RuntimeSuspensionSnapshotInput
  /** Waiters to register before the suspension commits. */
  readonly suspends: readonly RuntimeSuspendRegistration[]
}

/** Input for appending an event and firing matching waiters. */
export interface EmitEventInput {
  /** Runtime namespace. */
  readonly namespace: string
  /** Durable event name. */
  readonly name: string
  /** JSON event payload. */
  readonly payload: JsonValue
  /** Optional event id for duplicate append idempotency. */
  readonly eventId?: string
}

/** Result of appending an event through the kernel. */
export interface EmitEventResult {
  /** Durable event that was appended or deduplicated. */
  readonly event: RuntimeEvent
  /** Wake outbox rows produced for waiters that won the race. */
  readonly outboxItems: readonly RuntimeOutboxItem[]
}

/** Input for cancelling durable runtime work. */
export interface CancelWorkInput {
  /** Runtime namespace. */
  readonly namespace: string
  /** Work item to cancel. */
  readonly workId: WorkId
}

/** Result of an idempotent cancellation attempt. */
export interface CancelWorkResult {
  /** Whether this call moved a non-terminal work item to cancelled. */
  readonly cancelled: boolean
}

/** Input for scheduling store-backed runtime timer records. */
export interface ScheduleTimerInput {
  /** Runtime namespace. */
  readonly namespace: string
  /** Deadline when the timer becomes eligible to fire. */
  readonly fireAt: Date
  /** Work to carry when the timer fires. */
  readonly work: RuntimeWork
  /** Existing suspended work item to resume, when present. */
  readonly workId?: WorkId
  /** Linked waiter whose timeout CAS must win before work is produced. */
  readonly waiterId?: WaiterId
  /** Scoped-idle counter group to stamp onto work minted by the timer. */
  readonly idleScope?: string
}

/** Options for scanning due store-backed timers. */
export interface ScanTimersOptions {
  /** Namespace to scan. Omit only for maintenance diagnostics. */
  readonly namespace?: string
  /** Time used to decide whether a timer is due. */
  readonly now?: Date
  /** Maximum number of due timers to process. */
  readonly limit?: number
}

/** Result of one store-backed timer scan. */
export interface ScanTimersResult {
  /** Timers that won their race and produced wake work. */
  readonly fired: number
  /** Timers that were already handled, cancelled, or lost the waiter race. */
  readonly skipped: number
  /** Wake outbox rows produced by the scan. */
  readonly outboxItems: readonly RuntimeOutboxItem[]
}

/** Transaction helper result for firing one timer record. */
export interface FireTimerRecordResult {
  /** Whether this timer produced runnable work. */
  readonly fired: boolean
  /** Outbox item produced for the runnable work, when any. */
  readonly outboxItem?: RuntimeOutboxItem
}

/** Options for one kernel-owned maintenance pass. */
export interface MaintenanceTickOptions {
  /** Namespace to maintain. Omit only for diagnostics and local tests. */
  readonly namespace?: string
  /** Time source for due timers and outbox eligibility. */
  readonly now?: Date
  /** Maximum timers to scan. */
  readonly timerLimit?: number
  /** Maximum leased work records to inspect for reclaim. */
  readonly workLimit?: number
  /** Maximum expired waiter registrations to inspect. */
  readonly waiterLimit?: number
  /** Optional wake delivery function for the outbox dispatch backstop. */
  readonly deliver?: RuntimeWakeDeliver
}

/** Summary of a kernel-owned maintenance pass. */
export interface MaintenanceTickResult {
  /** Outbox rows delivered by the backstop dispatcher. */
  readonly outboxDelivered: number
  /** Outbox rows that failed delivery and were requeued. */
  readonly outboxFailed: number
  /** Timers that produced runnable work. */
  readonly timersFired: number
  /** Timers skipped because another race already won. */
  readonly timersSkipped: number
  /** Leased work moved back to pending after lease expiry. */
  readonly leasesReclaimed: number
  /** Waiters expired by the no-native-timer backstop. */
  readonly waitersExpired: number
  /** Retention records removed. I4 has no retention policy yet. */
  readonly retainedRecordsRemoved: number
}

/** Outcome of a wake handling attempt. */
export type RuntimeWakeResult =
  | {
      readonly status: 200
      readonly outcome:
        | 'processed'
        | 'duplicate'
        | 'stale'
        | 'blocked'
        | 'retry-scheduled'
        | 'dead-lettered'
    }
  | { readonly status: 401; readonly outcome: 'unverified' }
  | { readonly status: 409; readonly outcome: 'busy' }

/** Runtime kernel operations for durable work and wake handling. */
export interface RuntimeKernel {
  /** Create pending task work and write its wake envelope to the outbox. */
  enqueueTask(input: EnqueueTaskInput): Promise<WorkItem>
  /** Persist a flow suspension and owned waiter registrations atomically. */
  recordSuspension(input: RecordSuspensionInput): Promise<void>
  /** Append an event and resume all matching waiters that win the CAS race. */
  emitEvent(input: EmitEventInput): Promise<EmitEventResult>
  /** Cancel non-terminal work and its owned waiter/timer registrations. */
  cancelWork(input: CancelWorkInput): Promise<CancelWorkResult>
  /** Persist a store-backed timer record. */
  scheduleTimer(input: ScheduleTimerInput): Promise<RuntimeTimerRecord>
  /** Fire due store-backed timers through the waiter CAS race gate. */
  scanTimers(options?: ScanTimersOptions): Promise<ScanTimersResult>
  /** Run one kernel-owned maintenance pass. */
  maintenanceTick(
    options?: MaintenanceTickOptions,
  ): Promise<MaintenanceTickResult>
  /** Handle one verified wake envelope through lease, execution, and commit. */
  handleWake(envelope: WakeEnvelope): Promise<RuntimeWakeResult>
}
