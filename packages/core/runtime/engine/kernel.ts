/**
 * Runtime Engine kernel factory.
 *
 * The public kernel surface stays small; individual composite operations live
 * in focused modules so correctness logic remains readable and testable.
 *
 * @module
 */

import { emitEvent, recordSuspension } from './kernel-events'
import { cancelWork } from './kernel-cancellation'
import { enqueueTask } from './kernel-tasks'
import { retryWork } from './kernel-retry'
import { scanTimers, scheduleTimer } from './kernel-timers'
import { maintenanceTick } from './maintenance'
import type { WakeEnvelope } from './envelope'
import type {
  EmitEventInput,
  EnqueueTaskInput,
  CancelWorkInput,
  RetryWorkInput,
  RecordSuspensionInput,
  RuntimeKernel,
  RuntimeLeaseExtensionOptions,
  RuntimeLeaseExtensionSchedule,
  RuntimeKernelOptions,
  MaintenanceTickOptions,
  ScanTimersOptions,
  ScheduleTimerInput,
} from './kernel-types'
import { handleWake } from './kernel-wake'
import { resolveRuntimeRetentionConfig } from './retention'
import { runDefaultRuntimeComposite } from './composites'

const DEFAULT_LEASE_TTL_MS = 60_000

export type {
  CancelWorkInput,
  CancelWorkResult,
  RetryWorkInput,
  RetryWorkResult,
  EmitEventInput,
  EmitEventResult,
  EnqueueTaskInput,
  RecordSuspensionInput,
  RuntimeKernel,
  RuntimeKernelOptions,
  MaintenanceTickOptions,
  MaintenanceTickResult,
  ScanTimersOptions,
  ScanTimersResult,
  ScheduleTimerInput,
  RuntimeSuspendRegistration,
  RuntimeSuspensionSnapshotInput,
  RuntimeScheduledEffectIntent,
  RuntimeScheduledEffectFlushRecord,
  RuntimeLeaseExtensionOptions,
  RuntimeLeaseExtensionSchedule,
  RuntimeTarget,
  RuntimeTargetContext,
  RuntimeTargetMap,
  RuntimeTargetOutcome,
  RuntimeWakeResult,
} from './kernel-types'

export { wakeEnvelopeForWork } from './kernel-shared'

/** Create a runtime kernel from store, target registry, and deterministic hooks. */
export function createRuntimeKernel(
  options: RuntimeKernelOptions,
): RuntimeKernel {
  const now = options.now ?? (() => new Date())
  const verifyWake = options.verifyWake ?? (() => true)
  const leaseTtlMs = options.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS
  const retention = resolveRuntimeRetentionConfig(options.retention, {
    redeliveryHorizonMs: options.redeliveryHorizonMs,
  })
  const compositeDeps = {
    now,
    newWorkId: options.newWorkId,
  }
  const runComposite =
    options.store.runComposite ??
    ((kind, input) =>
      runDefaultRuntimeComposite(options.store, compositeDeps, kind, input))
  const deps = Object.freeze({
    store: options.store,
    runComposite,
    targets: options.targets,
    verifyWake,
    newWorkId: options.newWorkId,
    now,
    rng: options.rng,
    leaseTtlMs,
    leaseExtension: options.leaseExtension,
    retention,
  })

  return Object.freeze({
    enqueueTask: (input: EnqueueTaskInput) => enqueueTask(deps, input),
    recordSuspension: (input: RecordSuspensionInput) =>
      recordSuspension(deps, input),
    emitEvent: (input: EmitEventInput) => emitEvent(deps, input),
    cancelWork: (input: CancelWorkInput) => cancelWork(deps, input),
    retryWork: (input: RetryWorkInput) => retryWork(deps, input),
    scheduleTimer: (input: ScheduleTimerInput) => scheduleTimer(deps, input),
    scanTimers: (options?: ScanTimersOptions) => scanTimers(deps, options),
    maintenanceTick: (options?: MaintenanceTickOptions) =>
      maintenanceTick(deps, options),
    handleWake: (envelope: WakeEnvelope) => handleWake(deps, envelope),
  })
}
