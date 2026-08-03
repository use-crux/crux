/** Durable candidate queuing for deployed Signal predicates. */

import type { JsonValue } from "../../storage";
import type { EventCursor } from "../ports/ids";
import type { RuntimeWaiter } from "../ports/waiters";
import type { RuntimeOutboxItem, RuntimeStoreTransaction } from "../store";
import type { RuntimeCompositeDeps } from "./composites";
import { flowEventResumeKey } from "./idempotency";
import { wakeEnvelopeForWork } from "./kernel-shared";
import { recordApplicationWorkResumption } from "./application-work-events";

interface QueuePredicateCandidateOptions {
  readonly tx: RuntimeStoreTransaction;
  readonly deps: RuntimeCompositeDeps;
  readonly waiter: RuntimeWaiter;
  readonly eventId: EventCursor;
  readonly payload: JsonValue;
}

/** Return true for a waiter backed by deployed predicate code. */
export function isPredicateSignalWaiter(waiter: RuntimeWaiter): boolean {
  return (
    waiter.source?.kind === "signal" && waiter.source.filterKind === "predicate"
  );
}

/** Append one candidate while retaining the predicate waiter and its timer. */
export async function queuePredicateCandidate(
  options: QueuePredicateCandidateOptions,
): Promise<readonly RuntimeOutboxItem[]> {
  const workId = options.waiter.workId;
  if (!workId || options.waiter.work.kind !== "flow.resume") {
    throw new Error("Predicate Signal waiter must belong to Flow resume work.");
  }
  const current = await options.tx.state.getWork(workId, {
    namespace: options.waiter.namespace,
  });
  if (
    !current ||
    (current.status !== "suspended" &&
      current.status !== "pending" &&
      current.status !== "leased")
  ) {
    throw new Error("Predicate Signal delivery found non-resumable Flow work.");
  }

  await options.tx.state.markSnapshotDelivered(workId, {
    namespace: options.waiter.namespace,
    waiterId: options.waiter.waiterId,
    eventId: options.eventId,
    payload: options.payload,
    predicateCandidate: true,
  });
  if (current.status !== "suspended") return [];

  const idempotencyKey = flowEventResumeKey(workId, options.eventId);
  let pending = await options.tx.state.setWorkPending(workId, {
    namespace: options.waiter.namespace,
    work: options.waiter.work,
    idempotencyKey,
    now: options.deps.now(),
  });
  if (!pending) throw new Error("Predicate Signal wake arbitration was lost.");
  pending = await recordApplicationWorkResumption(
    options.tx,
    current,
    pending,
    options.deps.now(),
  );
  return [
    await options.tx.outbox.put(
      { ...wakeEnvelopeForWork(pending), idempotencyKey },
      { deliverAt: options.deps.now() },
    ),
  ];
}
