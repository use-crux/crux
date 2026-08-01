/** Atomic arbitration for manual Flow resume. */

import type { FlowId, WorkId } from "../../ports/ids";
import type { RuntimeWork } from "../../ports/work";
import type { RuntimeStoreTransaction } from "../../store";
import type { RuntimeCompositeDeps } from "../composites";
import type { WorkItem } from "../work";

/** Input accepted by the `flow.manual-resume` composite. */
export interface FlowManualResumeInput {
  /** Runtime namespace that owns the Flow. */
  readonly namespace: string;
  /** Durable Flow instance to resume. */
  readonly flowId: FlowId;
  /** Work item owned by the Flow snapshot. */
  readonly workId: WorkId;
  /** Work payload selected from the current suspension and deadline. */
  readonly work: RuntimeWork;
  /** Unique identity for this manual resume attempt. */
  readonly idempotencyKey: string;
}

/**
 * Claim a suspended Flow for manual resume without racing its waiter or timer.
 *
 * @remarks A pending waiter delivery has already won arbitration and is
 * returned unchanged. An armed suspension is cancelled before its work becomes
 * pending. Any other state returns `null` without partial cancellation.
 */
export async function resumeFlowManuallyInTransaction(
  tx: RuntimeStoreTransaction,
  deps: RuntimeCompositeDeps,
  input: FlowManualResumeInput,
): Promise<WorkItem | null> {
  const snapshot = await tx.state.getSnapshot(input.flowId, {
    namespace: input.namespace,
  });
  const current = await tx.state.getWork(input.workId, {
    namespace: input.namespace,
  });
  if (
    !snapshot ||
    snapshot.workId !== input.workId ||
    snapshot.status !== "suspended" ||
    !current
  ) {
    return null;
  }
  if (current.status === "pending") return current;
  if (current.status !== "suspended") return null;

  const ownedWaiters = await tx.waiters.listByWork(input.workId);
  const waiterById = new Map(
    ownedWaiters.map((waiter) => [waiter.waiterId, waiter] as const),
  );
  const bindings = snapshot.pendingSuspends.flatMap((suspend) => {
    if (!suspend.waiterId) return [];
    const waiter = waiterById.get(suspend.waiterId);
    return waiter ? [{ suspend, waiter }] : [];
  });
  if (bindings.some(({ waiter }) => waiter.state !== "armed")) return null;

  for (const { suspend, waiter } of bindings) {
    const cancelled = await tx.waiters.transition(
      waiter.waiterId,
      "armed",
      "cancelled",
    );
    if (!cancelled) {
      throw new Error("Flow manual-resume waiter arbitration was lost.");
    }
    const timerId = suspend.timerId ?? waiter.timerId;
    if (timerId) {
      await tx.timers.transition(timerId, "scheduled", "cancelled");
    }
  }

  return await tx.state.setWorkPending(input.workId, {
    namespace: input.namespace,
    work: input.work,
    idempotencyKey: input.idempotencyKey,
    now: deps.now(),
  });
}
