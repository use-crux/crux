/** Private authenticated deployed Eval host protocol. @internal @module */

export { createMemoryEvalHost } from "./host";
export { createResolvedEvalHost, type ResolvedEvalHost } from "./runtime";
export { createNodeEvalHost } from "./adapters/node";
export { createServerlessEvalHost } from "./adapters/serverless";
export {
  createEvalHostClient,
  EvalHostClientError,
  EvalHostClientTransportError,
  EVAL_HOST_MAX_RESPONSE_BYTES,
  EVAL_HOST_REQUEST_TIMEOUT_MS,
  type EvalHostClient,
  type EvalHostClientRequestOptions,
  type EvalHostClientTransportErrorCode,
  type EvalHostTransport,
} from "./client";
export { createEvalHostManifest } from "./manifest";
export {
  attachEvalHostConnectionInference,
  getEvalHostConnectionInference,
  type EvalHostConnectionDefaults,
  type EvalHostConnectionInference,
} from "./connection-inference";
export { canonicalRuntimeResult, createRuntimeResultLocation } from "./results";
export { EvalHostSetupError, type EvalHostSetupErrorCode } from "./setup";
export {
  decodeEvalHostManifest,
  decodeEvalHostManifestV1,
  decodeEvalHostManifestV2,
  EvalHostManifestCompatibilityError,
} from "./validation/manifest";
export {
  decodeEvalHostJobStatus,
  decodeEvalHostJobStatusV1,
  decodeEvalHostJobStatusV2,
} from "./validation/status";
export {
  EVAL_HOST_MAX_BODY_BYTES,
  EVAL_HOST_MAX_DEADLINE_HORIZON_MS,
  EvalHostProtocolError,
  decodeSubmitEvalJob,
  decodeSubmitEvalJobV1,
  decodeSubmitEvalJobV2,
  readEvalHostRequestBytes,
} from "./protocol";
export { hasEvalHostAuthorization } from "./auth";
export {
  insecureTransportError,
  isSecureRequest,
  jsonResponse,
  unauthorizedError,
} from "./transport";
export {
  CRUX_EVAL_HOST_PROTOCOL,
  CRUX_EVAL_HOST_PROTOCOL_V1,
  CRUX_EVAL_HOST_PROTOCOL_V2,
  EVAL_HOST_STRUCTURED_TIMEOUT_CAPABILITY,
  EVAL_HOST_RESULT_CODEC_VERSION,
  type CreateMemoryEvalHostOptions,
  type CreateNodeEvalHostOptions,
  type CreateServerlessEvalHostOptions,
  type EvalHostFetchHandler,
  type EvalHostAdmissionInput,
  type EvalHostAdmissionPort,
  type EvalHostAdmissionResult,
  type EvalHostStore,
  type EvalHostKind,
  type EvalHostManifestEntryV1,
  type EvalHostManifest,
  type EvalHostManifestV1,
  type EvalHostManifestV2,
  type EvalHostJobStatusV1,
  type EvalHostJobStatusV2,
  type EvalHostDeadlineV2,
  type EvalHostTimeoutV2,
  type MemoryEvalHost,
  type ServerlessEvalHost,
  type SubmitEvalJobV1,
  type SubmitEvalJobV2,
} from "./types";
