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
import type { FlowId, RuntimeTargetId, TaskId, WorkId } from '../ports/ids'
import type { RuntimeOutboxItem, RuntimeStoreAdapter } from '../store'
import type { WakeEnvelope } from './envelope'
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
}

/** One suspend/wait registration produced by replay. */
export interface RuntimeSuspendRegistration {
  /** User-authored suspend/wait label. */
  readonly label: string
  /** Event name that can resume this suspend point. */
  readonly eventName: string
  /** Top-level payload equality match for this waiter. */
  readonly match: Readonly<Record<string, JsonValue>>
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
  /** Handle one verified wake envelope through lease, execution, and commit. */
  handleWake(envelope: WakeEnvelope): Promise<RuntimeWakeResult>
}
