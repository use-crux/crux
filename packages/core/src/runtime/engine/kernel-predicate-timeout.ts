/** Timeout arbitration for durable Signal predicate candidates. */

import type { RuntimeWaiter } from "../ports/waiters";
import type { RuntimeStoreTransaction } from "../store";
import { isPredicateSignalWaiter } from "./kernel-predicate-wait";

/** Keep a predicate binding armed while its queued candidates are in flight. */
export async function shouldDeferPredicateTimeout(
  tx: RuntimeStoreTransaction,
  waiter: RuntimeWaiter,
): Promise<boolean> {
  if (
    waiter.state !== "armed" ||
    !waiter.workId ||
    !isPredicateSignalWaiter(waiter)
  ) {
    return false;
  }
  const work = await tx.state.getWork(waiter.workId, {
    namespace: waiter.namespace,
  });
  return work?.status === "pending" || work?.status === "leased";
}
