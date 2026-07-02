/**
 * `@use-crux/core/runtime` — Runtime Engine contracts and pure helpers.
 *
 * This subpath exposes the provider-agnostic Runtime Engine surface for adapter
 * authors, conformance tests, generated wake handlers, and advanced users who
 * need to reason about durable work directly.
 *
 * @module
 */

export {
  CruxRuntimeError,
  RUNTIME_ERROR_CODES,
  createRuntimeError,
  runtimeErrorDocsUrl,
} from './engine/errors'
export type { CruxRuntimeErrorCode, RuntimeErrorInput } from './engine/errors'

export {
  MAX_WAKE_ENVELOPE_BYTES,
  decodeWakeEnvelope,
  encodeWakeEnvelope,
} from './engine/envelope'
export type { WakeEnvelope } from './engine/envelope'

export { classifyRuntimeFailure, retryDelayMs } from './engine/retry'
export type {
  RetryDelayOptions,
  RuntimeFailureClassification,
  RuntimeFailureClassificationOptions,
} from './engine/retry'

export { transition } from './engine/work'
export type {
  WorkItem,
  WorkItemError,
  WorkStatus,
  WorkTransition,
} from './engine/work'

export { createRuntimeKernel, wakeEnvelopeForWork } from './engine/kernel'
export type {
  CancelWorkInput,
  CancelWorkResult,
  EmitEventInput,
  EmitEventResult,
  EnqueueTaskInput,
  MaintenanceTickOptions,
  MaintenanceTickResult,
  RecordSuspensionInput,
  RuntimeKernel,
  RuntimeKernelOptions,
  RuntimeScheduledEffectFlushRecord,
  RuntimeScheduledEffectIntent,
  RuntimeSuspendRegistration,
  RuntimeSuspensionSnapshotInput,
  RuntimeTarget,
  RuntimeTargetContext,
  RuntimeTargetMap,
  RuntimeTargetOutcome,
  RuntimeWakeResult,
  ScanTimersOptions,
  ScanTimersResult,
  ScheduleTimerInput,
} from './engine/kernel'

export { createRuntime } from './api/create-runtime'
export type {
  CreateRuntimeOptions,
  ResolvedRuntimeEngine,
  RuntimeEngineDefinition,
  RuntimeMaintenanceController,
  RuntimeMaintenanceHandle,
  RuntimeMaintenanceLoopOptions,
  RuntimeMaintenanceTickOptions,
  RuntimeWakeFactoryInput,
} from './api/create-runtime'

export { runtimeRequiredError } from './api/runtime-required'
export type {
  RuntimeRequiredError,
  RuntimeRequiredErrorOptions,
} from './api/runtime-required'

export { task } from './api/task'
export type {
  RuntimeTaskContext,
  RuntimeTaskInput,
  RuntimeTaskOptions,
  RuntimeTaskTarget,
} from './api/task'

export { node } from './composers/node'
export type { NodeRuntimeOptions } from './composers/node'

export { createOutboxDispatcher, dispatchBatch } from './engine/outbox'
export type {
  DispatchBatchOptions,
  DispatchBatchResult,
  RuntimeOutboxDispatcher,
  RuntimeWakeDeliver,
} from './engine/outbox'

export {
  flowEventResumeKey,
  flowSignalResumeKey,
  taskRunKey,
  timerKey,
  waiterTimeoutKey,
  watchDeliverKey,
} from './engine/idempotency'

export type * from './ports'
export type * from './store'

export { inMemoryRuntimeStore } from './adapters/memory'
export type {
  InMemoryRuntimeStore,
  InMemoryRuntimeStoreTesting,
} from './adapters/memory'
