/**
 * Canonical provider-neutral conversation history.
 *
 * @module
 */

export { thread } from "./thread";
export {
  ThreadCommitError,
  ThreadError,
  ThreadInUseError,
} from "./errors";
export type { ThreadErrorCode } from "./errors";
export type {
  AppendOptions,
  RedactedThreadEntry,
  RemovedThreadEntry,
  Thread,
  ThreadCommit,
  ThreadEntry,
  ThreadEditPatch,
  ThreadMessage,
  ThreadMessageInput,
  ThreadOptions,
  ThreadReadOptions,
  ThreadSnapshot,
  ThreadVariantInfo,
} from "./types";
export type {
  ThreadBridgeBranch,
  ThreadBridgeGroup,
  ThreadBridgeNode,
  ThreadRuntimeBridgePayload,
} from "./runtime-bridge";
