/** In-memory Session fault-injection diagnostics. */

import { createRuntimeError } from "../../engine/errors";
import type {
  CheckpointRuntimeSessionExecutionInput,
  RuntimeSessionPreparedExecution,
} from "../../ports/sessions";

export function assertSameSessionCheckpoint(
  existing: RuntimeSessionPreparedExecution,
  input: CheckpointRuntimeSessionExecutionInput,
): void {
  if (
    existing.workId !== input.workId ||
    existing.preparedResultRef.sha256 !== input.preparedResultRef.sha256 ||
    existing.preparedResultRef.location !== input.preparedResultRef.location
  ) {
    throw new Error(
      `Session input "${input.inputId}" has conflicting execution evidence.`,
    );
  }
}

export function sessionCheckpointCrash(workId: string) {
  return createRuntimeError({
    code: "LEASE_LOST",
    whatFailed: `Runtime work \`${workId}\` stopped after its prepared execution checkpoint.`,
    why: "The in-memory test adapter injected process loss before owner-Thread publication.",
    whatStillWorks:
      "The write-once checkpoint can be finalized by the next Runtime worker attempt.",
    nextStep: "Retry through the Runtime worker.",
  });
}

export function sessionIngressDeliveryCrash(workId: string) {
  return createRuntimeError({
    code: "LEASE_LOST",
    whatFailed: `Runtime work \`${workId}\` stopped at its Session ingress boundary.`,
    why: "The in-memory test adapter injected process loss before request preparation.",
    whatStillWorks:
      "The rolled-back boundary can be claimed exactly once by the next Runtime worker attempt.",
    nextStep: "Retry through the Runtime worker.",
  });
}
