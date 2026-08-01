/** Retry metadata carried from target execution into the atomic wake commit. */

import type { FlowSnapshot } from "../ports/state";

class RuntimeRetryableTargetError extends Error {
  readonly retrySnapshot: FlowSnapshot;

  constructor(cause: unknown, retrySnapshot: FlowSnapshot) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = cause instanceof Error ? cause.name : "Error";
    this.retrySnapshot = retrySnapshot;
  }
}

/** Attach a Flow snapshot update to an otherwise ordinary target failure. @internal */
export function runtimeRetryableTargetError(
  cause: unknown,
  retrySnapshot: FlowSnapshot,
): Error {
  return new RuntimeRetryableTargetError(cause, retrySnapshot);
}

/** Read the Flow snapshot that must commit atomically with a target retry. @internal */
export function runtimeRetrySnapshotForError(
  error: unknown,
): FlowSnapshot | undefined {
  return error instanceof RuntimeRetryableTargetError
    ? error.retrySnapshot
    : undefined;
}
