/** Predicate candidate dequeue and durable binding retention. */

import type { WaiterId } from "../ports/ids";
import type {
  FlowSnapshot,
  RuntimeDeliveredSuspend,
  RuntimeDeliveredSuspends,
  RuntimePendingSuspend,
} from "../ports/state";
import type { RuntimeStoreTransaction } from "../store";
import type { RuntimeSuspendRegistration } from "./kernel-suspension-types";

interface PreparedPredicateSuspends {
  readonly pending: readonly RuntimePendingSuspend[];
  readonly retainedWaiterIds: ReadonlySet<WaiterId>;
  readonly deliveredSuspends: RuntimeDeliveredSuspends | undefined;
  readonly nextCandidate?: RuntimeDeliveredSuspend;
}

/** Preserve an armed predicate binding and dequeue only its evaluated head. */
export async function preparePredicateSuspends(
  tx: RuntimeStoreTransaction,
  current: FlowSnapshot | null,
  suspends: readonly RuntimeSuspendRegistration[],
  delivered: RuntimeDeliveredSuspends | undefined,
  register: (
    suspend: RuntimeSuspendRegistration,
  ) => Promise<RuntimePendingSuspend>,
): Promise<PreparedPredicateSuspends> {
  const waiters = current ? await tx.waiters.listByWork(current.workId) : [];
  const waiterById = new Map(
    waiters.map((waiter) => [waiter.waiterId, waiter] as const),
  );
  const retained = new Set<WaiterId>();
  const pending: RuntimePendingSuspend[] = [];

  for (const suspend of suspends) {
    const existing = suspend.signalPredicate
      ? findPredicateSuspend(current, suspend)
      : undefined;
    const waiter = existing?.waiterId
      ? waiterById.get(existing.waiterId)
      : undefined;
    if (existing?.waiterId && waiter?.state === "armed") {
      retained.add(existing.waiterId);
      pending.push({
        ...existing,
        label: suspend.label,
        deliveryKey: suspend.deliveryKey,
        delivered: undefined,
        candidates: existing.candidates?.slice(1) ?? [],
      });
      continue;
    }
    pending.push(await register(suspend));
  }

  const persistedDelivered: Record<string, RuntimeDeliveredSuspend> =
    Object.fromEntries(
      Object.entries(delivered ?? {}).filter(
        (entry): entry is [string, RuntimeDeliveredSuspend] =>
          entry[1] !== undefined,
      ),
    );
  for (const suspend of suspends) {
    if (!suspend.signalPredicate) continue;
    delete persistedDelivered[suspend.deliveryKey ?? suspend.label];
  }
  for (const previous of current?.pendingSuspends ?? []) {
    if (
      !previous.signalPredicate ||
      !previous.waiterId ||
      retained.has(previous.waiterId)
    ) {
      continue;
    }
    const head = previous.candidates?.[0];
    if (head) persistedDelivered[previous.deliveryKey ?? previous.label] = head;
  }

  return {
    pending,
    retainedWaiterIds: retained,
    deliveredSuspends:
      Object.keys(persistedDelivered).length > 0
        ? Object.freeze(persistedDelivered)
        : undefined,
    nextCandidate: pending.find(({ candidates }) => candidates?.[0])
      ?.candidates?.[0],
  };
}

function findPredicateSuspend(
  snapshot: FlowSnapshot | null,
  suspend: RuntimeSuspendRegistration,
): RuntimePendingSuspend | undefined {
  const deliveryKey = suspend.deliveryKey ?? suspend.label;
  return snapshot?.pendingSuspends.find(
    (pending) =>
      pending.signalPredicate &&
      (pending.deliveryKey ?? pending.label) === deliveryKey,
  );
}

/** Merge candidates accepted after a leased execution loaded its snapshot. */
export function mergeFreshPredicateCandidates(
  retry: FlowSnapshot,
  fresh: FlowSnapshot | null,
): FlowSnapshot {
  if (!fresh) return retry;
  return {
    ...retry,
    pendingSuspends: retry.pendingSuspends.map((pending) => {
      if (!pending.signalPredicate) return pending;
      const current = fresh.pendingSuspends.find(
        (candidate) =>
          candidate.signalPredicate &&
          (candidate.deliveryKey ?? candidate.label) ===
            (pending.deliveryKey ?? pending.label),
      );
      return current
        ? {
            ...pending,
            waiterId: current.waiterId,
            timerId: current.timerId,
            timeoutAt: current.timeoutAt,
            candidates: current.candidates,
          }
        : pending;
    }),
  };
}

/** Persist a retry snapshot without overwriting concurrently queued candidates. */
export async function persistMergedRetrySnapshot(
  tx: RuntimeStoreTransaction,
  retry: FlowSnapshot | undefined,
): Promise<void> {
  if (!retry) return;
  const fresh = await tx.state.getSnapshot(retry.flowId, {
    namespace: retry.namespace,
  });
  await tx.state.putSnapshot(mergeFreshPredicateCandidates(retry, fresh));
}
