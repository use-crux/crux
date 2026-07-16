/** Private authenticated deployed Eval host protocol. @internal @module */

export { createMemoryEvalHost } from "./host";
export { createNodeEvalHost } from "./adapters/node";
export { createServerlessEvalHost } from "./adapters/serverless";
export {
  createEvalHostClient,
  EvalHostClientError,
  type EvalHostClient,
  type EvalHostTransport,
} from "./client";
export { createEvalHostManifest } from "./manifest";
export { EvalHostSetupError, type EvalHostSetupErrorCode } from "./setup";
export { decodeEvalHostManifest } from "./validation/manifest";
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
  type EvalHostStore,
  type EvalHostKind,
  type EvalHostManifestEntryV1,
  type EvalHostManifestV1,
  type EvalHostJobStatusV1,
  type MemoryEvalHost,
  type ServerlessEvalHost,
  type SubmitEvalJobV1,
} from "./types";
