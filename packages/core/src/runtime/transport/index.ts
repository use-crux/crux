/**
 * Provider-neutral managed-transport contracts and durable envelope lifecycle.
 *
 * @module
 */

export type {
  RuntimeAcceptedTransportEnvelope,
  RuntimeAcceptedTransportPayload,
  RuntimeManagedTransportAdapterDeclaration,
  RuntimeManagedTransportBinding,
  RuntimeSignalTransportTarget,
  RuntimeTransportConfigRef,
} from "./contracts";
export type {
  RuntimeTransportBindingCheckpoint,
  RuntimeTransportBindingCheckpointIdentity,
  RuntimeTransportBindingStatus,
} from "./binding-checkpoint";
export { MAX_TRANSPORT_BINDING_CURSOR_BYTES } from "./binding-checkpoint";
export { RuntimeManagedTransportContractError } from "./errors";
export {
  isManagedStreamTerminalError,
  isSafeProviderErrorCode,
  ManagedStreamTerminalError,
  managedStreamTerminalErrorCode,
  TRANSPORT_ACK_FAILED,
  TRANSPORT_STREAM_TERMINAL_CODE,
} from "./stream-errors";
export {
  TRANSPORT_STREAM_CONTRACT_INVALID,
  validateStreamCursor,
  validateStreamItem,
} from "./stream-item";
export {
  validateRuntimeAcceptedTransportEnvelope,
  validateRuntimeAcceptedTransportPayload,
  validateRuntimeAuthenticatedRouting,
  validateRuntimeManagedTransportAdapterDeclaration,
  validateRuntimeManagedTransportBinding,
} from "./validation";

export type {
  RuntimeTransportDeliveryLineageEntry,
  RuntimeTransportEnvelopeFailure,
  RuntimeTransportEnvelopeIdentity,
  RuntimeTransportEnvelopeRecord,
  RuntimeTransportEnvelopeState,
} from "./records";
export { MAX_TRANSPORT_LINEAGE_ENTRIES } from "./records";
export type {
  AcceptRuntimeTransportEnvelopeInput,
  AcceptRuntimeTransportEnvelopeResult,
  ClaimRuntimeTransportEnvelopesOptions,
  CompleteRuntimeTransportNormalizationInput,
  FailRuntimeTransportNormalizationInput,
  PutRuntimeTransportBindingCheckpointInput,
  PutRuntimeTransportBindingCheckpointResult,
  ReplayRuntimeTransportEnvelopeInput,
  RuntimeTransportStorePort,
} from "./store";
export { transportEnvelopeDigest } from "./digest";
export {
  scopeProviderSignalsForEnvelope,
  transportPublicationIdempotencyKey,
} from "./publication-scope";
export {
  TransportEnvelopeConflictError,
  TransportEnvelopeNotFoundError,
  TransportEnvelopeNotReplayableError,
  TransportStoreMissingError,
} from "./lifecycle-errors";
export {
  acceptTransportEnvelope,
  type AcceptTransportEnvelopeOptions,
  type AcceptTransportEnvelopeResult,
} from "./accept";
export {
  claimTransportEnvelopes,
  normalizeClaimedTransportEnvelope,
  replayTransportEnvelope,
  type ClaimTransportEnvelopesOptions,
  type NormalizeClaimedTransportEnvelopeOptions,
  type NormalizeClaimedTransportEnvelopeResult,
  type ReplayTransportEnvelopeOptions,
} from "./normalize";
export {
  createTransportNormalizationRunner,
  type CreateTransportNormalizationRunnerOptions,
  type TransportNormalizationRunOnceOptions,
  type TransportNormalizationRunResult,
  type TransportNormalizationRunner,
} from "./runner";
export {
  emptyTransportEnvelopeStats,
  initialTransportStatistics,
  recordTransportStatistics,
  transportScopeStatsFromExport,
  transportStatistics,
  transportStatisticsFromExport,
  transportStatisticsIdentity,
  transportStatisticsOwner,
  type TransportStatisticsOptions,
} from "./statistics";
export {
  projectTransportEnvelope,
  type RuntimeTransportEnvelopeProjection,
} from "./projection";
export {
  MAX_TRANSPORT_BINDING_HEALTH,
  projectTransportBindingHealth,
  transportBindingHealth,
  type ProjectTransportBindingHealthOptions,
  type RuntimeTransportBindingHealth,
  type RuntimeTransportBindingHealthOutcomes,
  type RuntimeTransportBindingHealthSnapshot,
  type RuntimeTransportHealthCoverage,
  type RuntimeTransportKind,
  type TransportBindingHealthOptions,
} from "./binding-health";
export {
  emitTransportEnvelopeObservability,
  type TransportEnvelopeObservabilityAttributes,
} from "./envelope-observability";
