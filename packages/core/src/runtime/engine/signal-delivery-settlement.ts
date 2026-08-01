/** Signal delivery settlement and retained Flow binding cleanup. */

import type { RuntimeStoreTransaction } from "../store";
import { recordSignalDeliveryAttempt } from "../reactive/delivery-state";
import { cancelFlowSnapshotBindings } from "./flow-binding-arbitration";
import type { RuntimeTargetOutcome } from "./kernel-types";
import type { RuntimeWorkItem } from "./work";

/** Settle every candidate when Flow work reaches a terminal failure. */
export async function settleFailedSignalWork(
  tx: RuntimeStoreTransaction,
  work: RuntimeWorkItem,
  state: "failed" | "dead-letter",
  now: Date,
): Promise<void> {
  await recordSignalDeliveryAttempt(tx, work, state, now, {
    settleAllPredicateCandidates: true,
  });
  await cancelFlowSnapshotBindings(tx, await flowSnapshotForWork(tx, work));
}

/** Settle the selected delivery and cancel bindings once its wait is left. */
export async function settleCompletedSignalWork(
  tx: RuntimeStoreTransaction,
  work: RuntimeWorkItem,
  outcome: RuntimeTargetOutcome,
  now: Date,
): Promise<void> {
  const retainsPredicate =
    outcome.status === "suspended" &&
    outcome.suspension.suspends.some((suspend) => suspend.signalPredicate);
  await recordSignalDeliveryAttempt(
    tx,
    work,
    outcome.status === "blocked" ? "failed" : "delivered",
    now,
    { settleAllPredicateCandidates: !retainsPredicate },
  );
  if (!retainsPredicate && outcome.status !== "suspended") {
    await cancelFlowSnapshotBindings(tx, await flowSnapshotForWork(tx, work));
  }
}

async function flowSnapshotForWork(
  tx: RuntimeStoreTransaction,
  work: RuntimeWorkItem,
) {
  if (work.work.kind !== "flow.resume" && work.work.kind !== "flow.timeout") {
    return null;
  }
  return await tx.state.getSnapshot(work.work.flowId, {
    namespace: work.namespace,
  });
}
