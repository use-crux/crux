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
export { RuntimeManagedTransportContractError } from "./errors";
export {
  validateRuntimeAcceptedTransportEnvelope,
  validateRuntimeManagedTransportAdapterDeclaration,
  validateRuntimeManagedTransportBinding,
} from "./validation";

export type {
  RuntimeTransportEnvelopeFailure,
  RuntimeTransportEnvelopeIdentity,
  RuntimeTransportEnvelopeRecord,
  RuntimeTransportEnvelopeState,
} from "./records";
export type {
  AcceptRuntimeTransportEnvelopeInput,
  AcceptRuntimeTransportEnvelopeResult,
  ClaimRuntimeTransportEnvelopesOptions,
  CompleteRuntimeTransportNormalizationInput,
  FailRuntimeTransportNormalizationInput,
  ReplayRuntimeTransportEnvelopeInput,
  RuntimeTransportStorePort,
} from "./store";
export { transportEnvelopeDigest } from "./digest";
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
