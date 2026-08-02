/** Shared cancellation for bindings owned by one Flow snapshot. */

import type { FlowSnapshot } from "../ports/state";
import type { WaiterId } from "../ports/ids";
import type { RuntimeStoreTransaction } from "../store";

/** Cancel every armed waiter/timer except explicitly retained bindings. */
export async function cancelFlowSnapshotBindings(
  tx: RuntimeStoreTransaction,
  snapshot: FlowSnapshot | null,
  retainedWaiterIds: ReadonlySet<WaiterId> = new Set(),
): Promise<void> {
  if (!snapshot) return;
  const waiters = await tx.waiters.listByWork(snapshot.workId);
  const byId = new Map(waiters.map((waiter) => [waiter.waiterId, waiter]));
  for (const suspend of snapshot.pendingSuspends) {
    if (!suspend.waiterId || retainedWaiterIds.has(suspend.waiterId)) continue;
    const waiter = byId.get(suspend.waiterId);
    if (waiter?.state === "armed") {
      const cancelled = await tx.waiters.transition(
        waiter.waiterId,
        "armed",
        "cancelled",
      );
      if (!cancelled) throw new Error("Flow waiter cancellation was lost.");
    }
    const timerId = suspend.timerId ?? waiter?.timerId;
    if (timerId) {
      await tx.timers.transition(timerId, "scheduled", "cancelled");
    }
  }
}
