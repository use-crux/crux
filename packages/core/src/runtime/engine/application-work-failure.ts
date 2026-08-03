/** Safe persisted failure summaries for application Flow Work. */

import type { RuntimeStoreTransaction } from "../store";
import type { CruxRuntimeErrorCode } from "./errors";
import type { RuntimeWorkItem, WorkItemError } from "./work";

/** Serialized target failure entering the terminal wake composite. */
export type WakeFailureInput =
  | { readonly kind: "dead-letter"; readonly message: string }
  | {
      readonly kind: "blocked";
      readonly code: CruxRuntimeErrorCode;
      readonly message: string;
    };

/** Replace private target text for application Work before persistence. */
export async function applicationWorkFailure(
  tx: RuntimeStoreTransaction,
  work: RuntimeWorkItem,
  failure: WakeFailureInput,
  now: () => Date,
): Promise<WorkItemError> {
  const snapshot =
    work.work.kind === "flow.resume" || work.work.kind === "flow.timeout"
      ? await tx.state.getSnapshot(work.work.flowId, {
          namespace: work.namespace,
        })
      : null;
  const isApplicationWork = snapshot?.resultObligation?.kind === "required";
  return Object.freeze({
    code: failure.kind === "dead-letter" ? "WORK_DEAD_LETTERED" : failure.code,
    message: isApplicationWork
      ? failure.kind === "dead-letter"
        ? "Work failed during Flow execution."
        : "Work is blocked by a Runtime contract failure."
      : failure.message,
    at: now(),
  });
}
