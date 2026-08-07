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
} from "./binding-checkpoint";
export { MAX_TRANSPORT_BINDING_CURSOR_BYTES } from "./binding-checkpoint";
export { RuntimeManagedTransportContractError } from "./errors";
export {
  validateRuntimeAcceptedTransportEnvelope,
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
