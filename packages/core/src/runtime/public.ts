/**
 * `@use-crux/core/runtime` — Runtime Engine contracts and pure helpers.
 *
 * This subpath exposes the provider-agnostic Runtime Engine surface for adapter
 * authors, conformance tests, generated wake handlers, and advanced users who
 * need to reason about durable work directly.
 *
 * @module
 */

export * from "./engine/errors";

export * from "./reactive/payload-codec";

export type {
  RuntimeAcceptedTransportEnvelope,
  RuntimeAcceptedTransportPayload,
  RuntimeManagedTransportAdapterDeclaration,
  RuntimeManagedTransportBinding,
  RuntimeSignalTransportTarget,
  RuntimeTransportConfigRef,
  RuntimeTransportBindingCheckpoint,
  RuntimeTransportBindingCheckpointIdentity,
  RuntimeTransportBindingStatus,
  RuntimeTransportDeliveryLineageEntry,
  RuntimeTransportEnvelopeFailure,
  RuntimeTransportEnvelopeIdentity,
  RuntimeTransportEnvelopeProjection,
  RuntimeTransportEnvelopeRecord,
  RuntimeTransportEnvelopeState,
  RuntimeTransportStorePort,
  AcceptRuntimeTransportEnvelopeInput,
  AcceptRuntimeTransportEnvelopeResult,
  ClaimRuntimeTransportEnvelopesOptions,
  CompleteRuntimeTransportNormalizationInput,
  FailRuntimeTransportNormalizationInput,
  PutRuntimeTransportBindingCheckpointInput,
  PutRuntimeTransportBindingCheckpointResult,
  ReplayRuntimeTransportEnvelopeInput,
  AcceptTransportEnvelopeOptions,
  AcceptTransportEnvelopeResult,
  ClaimTransportEnvelopesOptions,
  NormalizeClaimedTransportEnvelopeOptions,
  NormalizeClaimedTransportEnvelopeResult,
  ReplayTransportEnvelopeOptions,
  CreateTransportNormalizationRunnerOptions,
  TransportNormalizationRunOnceOptions,
  TransportNormalizationRunResult,
  TransportNormalizationRunner,
  TransportStatisticsOptions,
} from "./transport";
export type {
  TransportEnvelopeOutcomeStats,
  TransportEnvelopeStats,
} from "../statistics";
export {
  RuntimeManagedTransportContractError,
  TransportEnvelopeConflictError,
  TransportEnvelopeNotFoundError,
  TransportEnvelopeNotReplayableError,
  TransportStoreMissingError,
  validateRuntimeAcceptedTransportEnvelope,
  validateRuntimeManagedTransportAdapterDeclaration,
  validateRuntimeManagedTransportBinding,
  transportEnvelopeDigest,
  acceptTransportEnvelope,
  claimTransportEnvelopes,
  normalizeClaimedTransportEnvelope,
  replayTransportEnvelope,
  createTransportNormalizationRunner,
  projectTransportEnvelope,
  transportStatistics,
  transportStatisticsIdentity,
  transportStatisticsOwner,
  emptyTransportEnvelopeStats,
  MAX_TRANSPORT_LINEAGE_ENTRIES,
  MAX_TRANSPORT_BINDING_CURSOR_BYTES,
  isManagedStreamTerminalError,
  isSafeProviderErrorCode,
  ManagedStreamTerminalError,
  managedStreamTerminalErrorCode,
  TRANSPORT_ACK_FAILED,
  TRANSPORT_STREAM_TERMINAL_CODE,
  TRANSPORT_STREAM_CONTRACT_INVALID,
  validateStreamCursor,
  validateStreamItem,
} from "./transport";


export { createRuntimeProgram } from "./program";
export type {
  CreateRuntimeProgramOptions,
  RuntimeProgram,
  RuntimeProgramTarget,
  RuntimeProgramTargetDeclaration,
  RuntimeProgramTargetDefinition,
  RuntimeProgramTargetDefinitionInput,
  RuntimeProgramTargetInput,
} from "./program";
export type {
  RuntimeEffectTarget,
  RuntimeEffectTargetDefinition,
} from "./effect-targets";
export type { RuntimeTargetDefinitionRef } from "./ports/target-definition";

export { createRuntimeWorker } from "./worker/create-runtime-worker";
export type {
  CreateRuntimeWorkerOptions,
  RuntimeWorker,
  RuntimeWorkerStopOptions,
} from "./worker/create-runtime-worker";
export {
  bindingLeaseResource,
  createWorkerTransportSupervision,
} from "./worker/worker-transport-supervision";
export type {
  CreateWorkerTransportSupervisionOptions,
  TransportSupervisionRunResult,
  TransportSupervisionRunner,
} from "./worker/worker-transport-supervision";
export type * from "./ports/maintenance-ownership";

export type {
  RuntimeArtifactManifest,
  RuntimeArtifactManifestEffectTarget,
  RuntimeArtifactManifestEval,
  RuntimeArtifactManifestEvalCase,
  RuntimeArtifactManifestEvalVariant,
  RuntimeArtifactManifestProvider,
  RuntimeArtifactManifestTarget,
  RuntimeArtifactManifestTransport,
  RuntimeArtifactTargetKind,
} from "./artifacts";

export {
  MAX_WAKE_ENVELOPE_BYTES,
  decodeWakeEnvelope,
  encodeWakeEnvelope,
} from "./engine/envelope";
export type { WakeEnvelope } from "./engine/envelope";

export {
  DEFAULT_RUNTIME_MAX_ATTEMPTS,
  classifyRuntimeFailure,
  retryDelayMs,
} from "./engine/retry";
export type {
  RetryDelayOptions,
  RuntimeFailureClassification,
  RuntimeFailureClassificationOptions,
} from "./engine/retry";
export type {
  ResolvedRuntimeRetentionConfig,
  ResolveRuntimeRetentionOptions,
  RuntimeRetentionConfig,
  RuntimeRetentionDurationInput,
} from "./engine/retention";

export { transition } from "./engine/work";
export type {
  RuntimeWorkItem,
  RuntimeWorkState,
  WorkItemError,
  WorkTransition,
} from "./engine/work";
export type {
  RuntimeApplicationWorkOwnership,
  RuntimeApplicationWorkProgress,
  RuntimeApplicationWorkState,
} from "./engine/application-work-state";

export { createRuntimeKernel, wakeEnvelopeForWork } from "./engine/kernel";
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
  RuntimeLeaseExtensionOptions,
  RuntimeLeaseExtensionSchedule,
  RuntimeKernelOptions,
  RuntimeScheduledWorkFlushRecord,
  RuntimeScheduledWorkIntent,
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
} from "./engine/kernel";
export type {
  WorkAcceptCompositeInput,
  WorkAcceptCompositeResult,
} from "./engine/kernel";

export {
  runDefaultRuntimeComposite,
  runtimeCompositeBodies,
} from "./engine/composites";
export type {
  RuntimeCompositeBody,
  RuntimeCompositeDeps,
  RuntimeCompositeInput,
  RuntimeCompositeKind,
  RuntimeCompositeResult,
  RuntimeCompositeRunner,
} from "./engine/composites";

export { bindHostRuntime } from "./api/bind-host-runtime";
export { createRuntime } from "./api/create-runtime";
export {
  createRuntimeWithHostContext,
  runWithRuntimeHost,
} from "./api/host-context";
export { remainingHostDeadlineMs } from "./api/host-lifecycle";
export { runtimeHostOnlyError } from "./api/runtime-definition";
export type {
  CreateRuntimeOptions,
  ResolvedRuntimeEngine,
  RuntimeMaintenanceController,
  RuntimeMaintenanceHandle,
  RuntimeMaintenanceTickOptions,
} from "./api/create-runtime";
export type { HostRuntimeBinding } from "./api/bind-host-runtime";
export type {
  RuntimeHostBinder,
  RuntimeHostBindingOptions,
  RuntimeHostContext,
} from "./api/host-context";
export type {
  CruxContextStorage,
  CruxHostDeadlineOptions,
  CruxHostLifecycle,
} from "./api/host-lifecycle";
export type {
  HostBoundRuntimeEngineDefinition,
  InProcessRuntimeEngineDefinition,
  RuntimeEngineDefinition,
  RuntimeHostOnlyErrorOptions,
  RuntimeMaintenanceLoopOptions,
  RuntimeWakeFactoryInput,
} from "./api/runtime-definition";

export { runtimeRequiredError } from "./api/runtime-required";
export type {
  RuntimeRequiredError,
  RuntimeRequiredErrorOptions,
} from "./api/runtime-required";

export { runtimeTargetMap } from "./api/target-registry";
export type { RuntimeTargetRuntimeRef } from "./api/target-registry";

export { durableTask } from "./api/task";
export type {
  RuntimeTaskContext,
  RuntimeTaskInput,
  RuntimeTaskOptions,
  RuntimeTaskTarget,
} from "./api/task";

export { node } from "./composers/node";
export type { NodeRuntimeOptions } from "./composers/node";

export { serverless } from "./composers/serverless";
export type {
  ServerlessRuntimeEnvironment,
  ServerlessRuntimeOptions,
} from "./composers/serverless";
export type { RuntimeNamespaceSource } from "./composers/namespace";

export { genericQueue } from "./composers/generic-queue";
export type { GenericQueueWakeOptions } from "./composers/generic-queue";

export type {
  RuntimeWakeAdapter,
  RuntimeWakeAdapterCapabilities,
  RuntimeWakeAdapterInput,
  RuntimeWakeMessage,
} from "./composers/wake-adapter";

export { createRuntimeHandler } from "./handler/create-runtime-handler";
export { normalizeRuntimeHandlerTargets } from "./handler/targets";
export type {
  CreateRuntimeHandlerOptions,
  RuntimeFetchHandlers,
} from "./handler/create-runtime-handler";
export type {
  NormalizeRuntimeHandlerTargetsOptions,
  RuntimeHandlerTarget,
} from "./handler/targets";

export { handleWakeRequest } from "./handler/core";
export type { HandleWakeRequestOptions } from "./handler/core";

export {
  CRUX_WAKE_SIGNATURE_HEADER,
  allowUnsignedDevWake,
  assertWakeSecret,
  devWakeSecret,
  hmacWakeVerifier,
  signWakeBody,
} from "./handler/verify";
export type {
  HmacWakeVerifierOptions,
  RuntimeWakeRequestVerifier,
  RuntimeWakeVerificationInput,
} from "./handler/verify";

export { createOutboxDispatcher, dispatchBatch } from "./engine/outbox";
export type {
  DispatchBatchOptions,
  DispatchBatchResult,
  RuntimeOutboxDispatcher,
  RuntimeWakeDeliver,
} from "./engine/outbox";

export {
  flowEventResumeKey,
  flowManualResumeKey,
  flowStartResumeKey,
  operatorRetryEventName,
  operatorRetryKey,
  taskRunKey,
  timerKey,
  waiterTimeoutKey,
} from "./engine/idempotency";
export { runtimeSignalEventName } from "./engine/replay";

export type {
  CruxEngineCapabilities,
  DeploymentSupport,
} from "./ports/capabilities";
export type {
  AppendEventOptions,
  DurableEventPort,
  NewRuntimeEvent,
  ReadEventsOptions,
  ReadEventsResult,
  RuntimeEvent,
} from "./ports/events";
export type {
  DeferredIntentId,
  DeferredScopeId,
  EventCursor,
  FlowId,
  LeaseToken,
  RuntimeTargetId,
  TaskId,
  TimerId,
  WaiterId,
  WorkId,
} from "./ports/ids";
export type {
  ListRuntimeDeferredIntentsOptions,
  ListRuntimeDeferredScopesOptions,
  RuntimeDeferredIntent,
  RuntimeDeferredIntentState,
  RuntimeDeferredScope,
  RuntimeDeferredStorePort,
  RuntimeDeferFinalization,
  RuntimeDeferInvocationOutcome,
} from "./ports/deferred";
export type {
  ClaimOptions,
  Lease,
  LeasePort,
  LeaseResource,
} from "./ports/leases";
export type {
  DurableEffectEnvelopeRecord,
  DurableEffectExecutionSettlement,
  DurableEffectPlanStep,
  DurableEffectPreparation,
  DurableEffectReceiptRecord,
  DurableEffectRecoveryClaim,
  DurableEffectRecoveryFailureSettlement,
  DurableEffectReconciliationRequirement,
  DurableEffectReconciliationRecord,
  DurableEffectReconciliationSettlement,
  DurableEffectRecoveryAttemptRecord,
  DurableEffectRecoveryPreparation,
  DurableEffectRecoverySettlement,
  DurableEffectRecoveryUnavailableSettlement,
  DurableEffectRecoveryUnitRecord,
  DurableEffectScopeRecord,
  DurableEffectScopeSnapshot,
  DurableEffectScopeSynchronization,
  RuntimeEffectReadOptions,
  RuntimeEffectRecoveryClaimOptions,
  RuntimeEffectRecoveryRelease,
  RuntimeEffectReceiptEvidenceLink,
  RuntimeEffectPruneOptions,
  RuntimeEffectReceiptTransition,
  RuntimeEffectScopeTransition,
  RuntimeEffectStorePort,
  RuntimeEffectUnitTransition,
} from "./ports/effects";
export type {
  RuntimeSetupApplyOptions,
  RuntimeSetupFinding,
  RuntimeSetupMode,
  RuntimeSetupOptions,
  RuntimeSetupPort,
  RuntimeSetupResult,
} from "./ports/setup";
export type {
  RuntimePruneOptions,
  RuntimePruneResult,
} from "./ports/retention";
export type {
  CountWorkOptions,
  FlowSnapshot,
  IdempotencyRecord,
  MarkSnapshotDeliveredOptions,
  NewWorkItem,
  RuntimeDeliveredSuspend,
  RuntimePendingSuspend,
  RuntimeStatePort,
  RuntimeStateReadOptions,
  SetWorkPendingOptions,
  WorkStatusCount,
} from "./ports/state";
export type {
  NewRuntimeWaiter,
  ResolveWaiterOptions,
  RuntimeWaiter,
  WaiterPort,
} from "./ports/waiters";
export type { RuntimeWork } from "./ports/work";
export type {
  ReactiveConsumerRef,
  RuntimeSignalStorePort,
  SignalDeliveryRecord,
  SignalOccurrenceRecord,
} from "./reactive/records";
export type * from "./store";

export { canonicalRuntimeResult } from "./results/canonical";
export {
  RUNTIME_RESULT_MAX_BYTES,
  RUNTIME_RESULT_MEDIA_TYPE,
} from "./results/types";
export type {
  RuntimeResultPayloadPort,
  RuntimeResultPruneOptions,
  RuntimeResultPutOptions,
  RuntimeResultRef,
} from "./results/types";

export { inMemoryRuntimeStore } from "./adapters/memory";
export type {
  InMemoryRuntimeStore,
  InMemoryRuntimeStoreTesting,
} from "./adapters/memory";
