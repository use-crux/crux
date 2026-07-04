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

export type {
  RuntimeArtifactManifest,
  RuntimeArtifactManifestTarget,
  RuntimeArtifactTargetKind,
} from './artifacts'

export {
  MAX_WAKE_ENVELOPE_BYTES,
  decodeWakeEnvelope,
  encodeWakeEnvelope,
} from './engine/envelope'
export type { WakeEnvelope } from './engine/envelope'

export {
  DEFAULT_RUNTIME_MAX_ATTEMPTS,
  classifyRuntimeFailure,
  retryDelayMs,
} from './engine/retry'
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
  RetryWorkInput,
  RetryWorkResult,
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

export { bindHostRuntime } from './api/bind-host-runtime'
export { createRuntime } from './api/create-runtime'
export {
  createRuntimeWithHostContext,
  runWithRuntimeHost,
} from './api/host-context'
export { runtimeHostOnlyError } from './api/runtime-definition'
export type {
  CreateRuntimeOptions,
  ResolvedRuntimeEngine,
  RuntimeMaintenanceController,
  RuntimeMaintenanceHandle,
  RuntimeMaintenanceTickOptions,
} from './api/create-runtime'
export type { HostRuntimeBinding } from './api/bind-host-runtime'
export type {
  RuntimeHostBinder,
  RuntimeHostBindingOptions,
  RuntimeHostContext,
} from './api/host-context'
export type {
  HostBoundRuntimeEngineDefinition,
  InProcessRuntimeEngineDefinition,
  RuntimeEngineDefinition,
  RuntimeHostOnlyErrorOptions,
  RuntimeMaintenanceLoopOptions,
  RuntimeWakeFactoryInput,
} from './api/runtime-definition'

export { runtimeRequiredError } from './api/runtime-required'
export type {
  RuntimeRequiredError,
  RuntimeRequiredErrorOptions,
} from './api/runtime-required'

export { runtimeTargetMap } from './api/target-registry'
export type { RuntimeTargetRuntimeRef } from './api/target-registry'

export { task } from './api/task'
export type {
  RuntimeTaskContext,
  RuntimeTaskInput,
  RuntimeTaskOptions,
  RuntimeTaskTarget,
} from './api/task'

export { node } from './composers/node'
export type { NodeRuntimeOptions } from './composers/node'

export { serverless } from './composers/serverless'
export type {
  ServerlessRuntimeEnvironment,
  ServerlessRuntimeOptions,
} from './composers/serverless'

export { genericQueue } from './composers/generic-queue'
export type { GenericQueueWakeOptions } from './composers/generic-queue'

export type {
  RuntimeWakeAdapter,
  RuntimeWakeAdapterCapabilities,
  RuntimeWakeAdapterInput,
  RuntimeWakeMessage,
} from './composers/wake-adapter'

export { createRuntimeHandler } from './handler/create-runtime-handler'
export { normalizeRuntimeHandlerTargets } from './handler/targets'
export type {
  CreateRuntimeHandlerOptions,
  RuntimeFetchHandlers,
} from './handler/create-runtime-handler'
export type {
  NormalizeRuntimeHandlerTargetsOptions,
  RuntimeHandlerTarget,
} from './handler/targets'

export { handleWakeRequest } from './handler/core'
export type { HandleWakeRequestOptions } from './handler/core'

export {
  CRUX_WAKE_SIGNATURE_HEADER,
  allowUnsignedDevWake,
  assertWakeSecret,
  devWakeSecret,
  hmacWakeVerifier,
  signWakeBody,
} from './handler/verify'
export type {
  HmacWakeVerifierOptions,
  RuntimeWakeRequestVerifier,
  RuntimeWakeVerificationInput,
} from './handler/verify'

export { createOutboxDispatcher, dispatchBatch } from './engine/outbox'
export type {
  DispatchBatchOptions,
  DispatchBatchResult,
  RuntimeOutboxDispatcher,
  RuntimeWakeDeliver,
} from './engine/outbox'

export {
  flowEventResumeKey,
  flowManualResumeKey,
  flowSignalResumeKey,
  flowStartResumeKey,
  operatorRetryEventName,
  operatorRetryKey,
  taskRunKey,
  timerKey,
  waiterTimeoutKey,
  watchDeliverKey,
} from './engine/idempotency'
export { runtimeSignalEventName } from './engine/replay'

export type * from './ports'
export type * from './store'

export { inMemoryRuntimeStore } from './adapters/memory'
export type {
  InMemoryRuntimeStore,
  InMemoryRuntimeStoreTesting,
} from './adapters/memory'
