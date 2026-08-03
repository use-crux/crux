/** Atomic completion of one leased Runtime Work target outcome. */

import type { RuntimeStoreTransaction } from "../store";
import { appendApplicationWorkStatusEvent } from "./application-work-events";
import { recordApplicationWorkTransition } from "./application-work-statistics";
import type { RuntimeCompositeDeps } from "./composites";
import { recordSuspensionInTransaction } from "./kernel-events";
import { putWorkWithIdleAccounting } from "./kernel-idle";
import { assertLeaseHeldInTransaction } from "./kernel-leases";
import {
  flushScheduledWorkInTransaction,
  mergeScheduledWorkRecords,
} from "./kernel-scheduled-work";
import type { RuntimeTargetOutcome } from "./kernel-types";
import { settleCompletedSignalWork } from "./signal-delivery-settlement";
import { transition, type RuntimeWorkItem } from "./work";
import type { LeaseToken } from "../ports/ids";

/** Commit a successful target outcome inside a transaction. */
export async function completeWorkInTransaction(
  tx: RuntimeStoreTransaction,
  deps: RuntimeCompositeDeps,
  input: {
    readonly work: RuntimeWorkItem;
    readonly leaseToken: LeaseToken;
    readonly outcome: RuntimeTargetOutcome;
    readonly idempotencyKey: string;
  },
): Promise<void> {
  const current = await assertLeaseHeldInTransaction(
    tx,
    input.work,
    input.leaseToken,
  );
  await settleCompletedSignalWork(tx, current, input.outcome, deps.now());
  if (input.outcome.status === "suspended") {
    await recordSuspensionInTransaction(tx, deps, input.outcome.suspension);
    await tx.state.putIdempotencyKey({
      namespace: current.namespace,
      key: input.idempotencyKey,
      completedAt: deps.now(),
    });
    return;
  }

  let completed =
    input.outcome.status === "completed"
      ? transition(current, {
          status: "completed",
          resultRef: input.outcome.resultRef,
        })
      : input.outcome.status === "cancelled"
        ? transition(current, { status: "cancelled" })
        : transition(current, {
            status: "blocked",
            lastError: input.outcome.error,
          });
  const completedAt = deps.now();
  completed = await appendApplicationWorkStatusEvent(
    tx,
    recordApplicationWorkTransition(current, completed, completedAt, {
      completed:
        completed.status === "completed" || completed.status === "cancelled",
      ...(completed.status === "cancelled"
        ? {
            facts: [
              { kind: "lifecycle" as const, event: "cancellation" as const },
            ],
          }
        : {}),
    }),
  );
  if (
    (input.outcome.status === "completed" ||
      input.outcome.status === "cancelled") &&
    "flowSnapshot" in input.outcome
  ) {
    const flushedWork = await flushScheduledWorkInTransaction(
      tx,
      input.outcome.scheduledWork,
      deps.now,
    );
    await tx.state.putSnapshot({
      ...input.outcome.flowSnapshot,
      scheduledWork: mergeScheduledWorkRecords(
        input.outcome.flowSnapshot.scheduledWork,
        flushedWork,
      ),
    });
  }
  await putWorkWithIdleAccounting(
    tx,
    { newWorkId: deps.newWorkId, now: deps.now },
    current,
    completed,
  );
  if (current.work.kind === "session.turn") {
    if (!tx.sessions)
      throw new Error("Runtime Session storage is unavailable.");
    const turn = {
      namespace: current.namespace,
      sessionId: current.work.sessionId,
      inputId: current.work.inputId,
      now: completedAt,
    };
    if (completed.status === "completed") await tx.sessions.completeTurn(turn);
    else if (completed.status === "blocked") await tx.sessions.blockTurn(turn);
  }
  await tx.state.putIdempotencyKey({
    namespace: current.namespace,
    key: input.idempotencyKey,
    completedAt: deps.now(),
  });
}
