/**
 * Named Runtime Engine composite commits.
 *
 * Composite bodies are kernel-owned transaction functions. Store adapters may
 * override {@link RuntimeStoreAdapter.runComposite} to execute a body in a
 * substrate-native atomic operation, while the default runner wraps the same
 * body in {@link RuntimeStoreAdapter.transact}.
 *
 * @module
 */

import type { LeaseToken, WorkId } from '../ports'
import type { RuntimeWaiter } from '../ports/waiters'
import type {
  RuntimeStoreAdapter,
  RuntimeStoreTransaction,
  RuntimeTimerRecord,
} from '../store'
import type { WakeEnvelope } from './envelope'
import { blockMissingTargetInTransaction } from './kernel-wake'
import {
  completeWorkInTransaction,
  failWorkInTransaction,
  retryWorkAfterFailureInTransaction,
  type WakeFailureInput,
} from './kernel-wake-commits'
import {
  emitEventInTransaction,
  recordSuspensionInTransaction,
} from './kernel-events'
import { fireDueTimersInTransaction } from './kernel-timers'
import { cancelWorkInTransaction } from './kernel-cancellation'
import { enqueueTaskInTransaction } from './kernel-tasks'
import { retryWorkInTransaction } from './kernel-retry'
import {
  expireWaitersInTransaction,
  reclaimLeasedWorkInTransaction,
  requeuePendingWorkIfStillOrphanedInTransaction,
} from './maintenance'
import type {
  CancelWorkInput,
  CancelWorkResult,
  EmitEventInput,
  EmitEventResult,
  EnqueueTaskInput,
  RecordSuspensionInput,
  RetryWorkInput,
  RetryWorkResult,
  RuntimeTargetOutcome,
  ScanTimersResult,
} from './kernel-types'
import type { WorkItem } from './work'
import type { RuntimeDeferredIntent } from '../ports/deferred'
import {
  abandonDeferredScopeInTransaction,
  expireDeferredScopeInTransaction,
  finalizeDeferredScopeInTransaction,
  renewDeferredScopeLeaseInTransaction,
  stageDeferredIntentInTransaction,
  type AbandonDeferredScopeInput,
  type DeferredScopeTransitionResult,
  type ExpireDeferredScopeInput,
  type ExpireDeferredScopeResult,
  type FinalizeDeferredScopeInput,
  type RenewDeferredScopeLeaseInput,
  type RenewDeferredScopeLeaseResult,
  type StageDeferredIntentInput,
} from './kernel-deferred'

/** Non-serialized kernel dependencies supplied to composite bodies. */
export interface RuntimeCompositeDeps {
  /** Current time source shared with the kernel. */
  readonly now: () => Date
  /** Kernel-owned work id generator for composites that mint work. */
  readonly newWorkId: () => WorkId
}

/** Named composite operation implemented by the Runtime Engine kernel. */
export type RuntimeCompositeKind =
  | 'wake.block-missing-target'
  | 'wake.retry'
  | 'wake.fail'
  | 'wake.complete'
  | 'suspension.record'
  | 'event.emit'
  | 'timers.fire-due'
  | 'task.enqueue'
  | 'work.cancel'
  | 'work.operator-retry'
  | 'maintenance.reclaim-lease'
  | 'maintenance.requeue-orphan'
  | 'maintenance.expire-waiters'
  | 'defer.stage'
  | 'defer.finalize'
  | 'defer.abandon'
  | 'defer.renew'
  | 'defer.expire'

/** Input payloads accepted by named composite operations. */
export interface RuntimeCompositeInput {
  /** Block non-terminal work when a wake names a missing target. */
  readonly 'wake.block-missing-target': {
    readonly envelope: WakeEnvelope
  }
  /** Requeue failed work after a retryable target failure. */
  readonly 'wake.retry': {
    readonly work: WorkItem
    readonly leaseToken: LeaseToken
    readonly retryAt: Date
  }
  /** Commit blocked or dead-lettered work after a terminal target failure. */
  readonly 'wake.fail': {
    readonly work: WorkItem
    readonly leaseToken: LeaseToken
    readonly failure: WakeFailureInput
  }
  /** Commit a successful target outcome for leased work. */
  readonly 'wake.complete': {
    readonly work: WorkItem
    readonly leaseToken: LeaseToken
    readonly outcome: RuntimeTargetOutcome
    readonly idempotencyKey: string
  }
  /** Persist a flow suspension and owned wait registrations. */
  readonly 'suspension.record': RecordSuspensionInput
  /** Append an event and resume matching waiters. */
  readonly 'event.emit': EmitEventInput
  /** Fire due timer records claimed before the composite. */
  readonly 'timers.fire-due': {
    readonly timers: readonly RuntimeTimerRecord[]
  }
  /** Create pending task work and write its wake envelope. */
  readonly 'task.enqueue': EnqueueTaskInput
  /** Cancel non-terminal work and its owned registrations. */
  readonly 'work.cancel': CancelWorkInput
  /** Move blocked or dead-lettered work back to pending. */
  readonly 'work.operator-retry': RetryWorkInput
  /** Reclaim one leased work row after its lease expired. */
  readonly 'maintenance.reclaim-lease': {
    readonly work: WorkItem
  }
  /** Requeue one pending work row when no pending wake remains. */
  readonly 'maintenance.requeue-orphan': {
    readonly work: WorkItem
  }
  /** Expire waiter rows claimed before the composite. */
  readonly 'maintenance.expire-waiters': {
    readonly waiters: readonly RuntimeWaiter[]
  }
  /** Durably stage named work without making it runnable. */
  readonly 'defer.stage': StageDeferredIntentInput
  /** Atomically finalize a scope and release all staged siblings. */
  readonly 'defer.finalize': FinalizeDeferredScopeInput
  /** Atomically abandon an unfinalized scope and all staged siblings. */
  readonly 'defer.abandon': AbandonDeferredScopeInput
  /** Renew an open deferred scope lease for a live owner heartbeat. */
  readonly 'defer.renew': RenewDeferredScopeLeaseInput
  /**
   * Atomically expire-and-abandon an open scope under maintenance takeover.
   * One transaction proves the observed fence/expiry, abandons siblings, and
   * ends terminal — never leaves an open scope under the maintenance token.
   */
  readonly 'defer.expire': ExpireDeferredScopeInput
}

/** Results returned by named composite operations. */
export interface RuntimeCompositeResult {
  /** No result. */
  readonly 'wake.block-missing-target': void
  /** No result. */
  readonly 'wake.retry': void
  /** No result. */
  readonly 'wake.fail': void
  /** No result. */
  readonly 'wake.complete': void
  /** No result. */
  readonly 'suspension.record': void
  /** Appended event and produced wake rows. */
  readonly 'event.emit': EmitEventResult
  /** Due timer scan summary. */
  readonly 'timers.fire-due': ScanTimersResult
  /** Fresh pending task work. */
  readonly 'task.enqueue': WorkItem
  /** Cancellation attempt result. */
  readonly 'work.cancel': CancelWorkResult
  /** Operator retry attempt result. */
  readonly 'work.operator-retry': RetryWorkResult
  /** Whether one leased work row was reclaimed. */
  readonly 'maintenance.reclaim-lease': boolean
  /** Whether one orphaned pending work row was requeued. */
  readonly 'maintenance.requeue-orphan': boolean
  /** Number of expired waiters that produced runnable work. */
  readonly 'maintenance.expire-waiters': number
  /** Accepted staged intent and its stable work identity. */
  readonly 'defer.stage': RuntimeDeferredIntent
  /** Result of the terminal finalization compare-and-set. */
  readonly 'defer.finalize': DeferredScopeTransitionResult
  /** Result of the terminal abandonment compare-and-set. */
  readonly 'defer.abandon': DeferredScopeTransitionResult
  /** Result of a deferred scope lease renew. */
  readonly 'defer.renew': RenewDeferredScopeLeaseResult
  /** Result of the atomic expire-and-abandon maintenance composite. */
  readonly 'defer.expire': ExpireDeferredScopeResult
}

/** Execute a named composite operation. */
export type RuntimeCompositeRunner = <K extends RuntimeCompositeKind>(
  kind: K,
  input: RuntimeCompositeInput[K],
) => Promise<RuntimeCompositeResult[K]>

/** Transaction-scoped implementation for one composite operation. */
export type RuntimeCompositeBody<K extends RuntimeCompositeKind> = (
  tx: RuntimeStoreTransaction,
  deps: RuntimeCompositeDeps,
  input: RuntimeCompositeInput[K],
) => Promise<RuntimeCompositeResult[K]>

/** Kernel-owned registry of named composite transaction bodies. */
export const runtimeCompositeBodies: {
  readonly [K in RuntimeCompositeKind]: RuntimeCompositeBody<K>
} = Object.freeze({
  'wake.block-missing-target': blockMissingTargetInTransaction,
  'wake.retry': retryWorkAfterFailureInTransaction,
  'wake.fail': failWorkInTransaction,
  'wake.complete': completeWorkInTransaction,
  'suspension.record': recordSuspensionInTransaction,
  'event.emit': emitEventInTransaction,
  'timers.fire-due': fireDueTimersInTransaction,
  'task.enqueue': enqueueTaskInTransaction,
  'work.cancel': cancelWorkInTransaction,
  'work.operator-retry': retryWorkInTransaction,
  'maintenance.reclaim-lease': reclaimLeasedWorkInTransaction,
  'maintenance.requeue-orphan': requeuePendingWorkIfStillOrphanedInTransaction,
  'maintenance.expire-waiters': expireWaitersInTransaction,
  'defer.stage': stageDeferredIntentInTransaction,
  'defer.finalize': finalizeDeferredScopeInTransaction,
  'defer.abandon': abandonDeferredScopeInTransaction,
  'defer.renew': renewDeferredScopeLeaseInTransaction,
  'defer.expire': expireDeferredScopeInTransaction,
})

/**
 * Run a composite through the default transaction wrapper.
 *
 * This is the behavior used by ordinary adapters. Substrate-native adapters can
 * provide `runComposite` and still call the same body registry server-side.
 */
export async function runDefaultRuntimeComposite<
  K extends RuntimeCompositeKind,
>(
  store: RuntimeStoreAdapter,
  deps: RuntimeCompositeDeps,
  kind: K,
  input: RuntimeCompositeInput[K],
): Promise<RuntimeCompositeResult[K]> {
  return await store.transact((tx) =>
    runtimeCompositeBodies[kind](tx, deps, input),
  )
}
