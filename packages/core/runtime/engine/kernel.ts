/**
 * Runtime Engine kernel factory.
 *
 * The public kernel surface stays small; individual composite operations live
 * in focused modules so correctness logic remains readable and testable.
 *
 * @module
 */

import { emitEvent, recordSuspension } from './kernel-events'
import { enqueueTask } from './kernel-tasks'
import type { WakeEnvelope } from './envelope'
import type {
  EmitEventInput,
  EnqueueTaskInput,
  RecordSuspensionInput,
  RuntimeKernel,
  RuntimeKernelOptions,
} from './kernel-types'
import { handleWake } from './kernel-wake'

const DEFAULT_LEASE_TTL_MS = 60_000

export type {
  EmitEventInput,
  EmitEventResult,
  EnqueueTaskInput,
  RecordSuspensionInput,
  RuntimeKernel,
  RuntimeKernelOptions,
  RuntimeSuspendRegistration,
  RuntimeSuspensionSnapshotInput,
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
  const deps = Object.freeze({
    store: options.store,
    targets: options.targets,
    verifyWake,
    newWorkId: options.newWorkId,
    now,
    rng: options.rng,
    leaseTtlMs,
  })

  return Object.freeze({
    enqueueTask: (input: EnqueueTaskInput) => enqueueTask(deps, input),
    recordSuspension: (input: RecordSuspensionInput) =>
      recordSuspension(deps, input),
    emitEvent: (input: EmitEventInput) => emitEvent(deps, input),
    handleWake: (envelope: WakeEnvelope) => handleWake(deps, envelope),
  })
}
