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
  EvalHostManifestCompatibilityError,
} from "./validation/manifest";
export { decodeEvalHostJobStatus } from "./validation/status";
export {
  EVAL_HOST_MAX_BODY_BYTES,
  EVAL_HOST_MAX_DEADLINE_HORIZON_MS,
  EvalHostProtocolError,
  decodeSubmitEvalJob,
} from "./protocol";
export {
  CRUX_EVAL_HOST_PROTOCOL,
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
  type EvalHostManifestV1,
  type EvalHostJobStatusV1,
  type MemoryEvalHost,
  type ServerlessEvalHost,
  type SubmitEvalJobV1,
} from "./types";
