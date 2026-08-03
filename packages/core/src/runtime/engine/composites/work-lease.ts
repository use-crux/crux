/** Atomic application Work lease transition and safe status publication. */

import type { LeaseToken, WorkId } from "../../ports/ids";
import type { RuntimeStoreTransaction } from "../../store";
import { appendApplicationWorkStatusEvent } from "../application-work-events";
import { recordApplicationWorkTransition } from "../application-work-statistics";
import type { RuntimeCompositeDeps } from "../composites";
import { transition, type RuntimeWorkItem } from "../work";

/** Input for moving one pending Work row under an acquired lease. */
export interface WorkLeaseCompositeInput {
  readonly namespace: string;
  readonly workId: WorkId;
  readonly leaseToken: LeaseToken;
}

/** Move pending Work to running and append its safe status atomically. */
export async function leaseWorkInTransaction(
  tx: RuntimeStoreTransaction,
  deps: RuntimeCompositeDeps,
  input: WorkLeaseCompositeInput,
): Promise<RuntimeWorkItem | null> {
  const current = await tx.state.getWork(input.workId, {
    namespace: input.namespace,
  });
  if (!current || current.status !== "pending") return null;
  const now = deps.now();
  const transitioned = recordApplicationWorkTransition(
    current,
    transition(current, { status: "leased", leaseToken: input.leaseToken }),
    now,
  );
  const leased = await appendApplicationWorkStatusEvent(
    tx,
    transitioned.application
      ? Object.freeze({
          ...transitioned,
          application: Object.freeze({
            ...transitioned.application,
            startedAt: transitioned.application.startedAt ?? now.toISOString(),
          }),
        })
      : transitioned,
  );
  await tx.state.putWork(leased);
  if (current.work.kind === "session.turn") {
    if (!tx.sessions)
      throw new Error("Runtime Session storage is unavailable.");
    await tx.sessions.startTurn({
      namespace: current.namespace,
      sessionId: current.work.sessionId,
      inputId: current.work.inputId,
      now,
    });
  }
  return leased;
}
