/** Signal delivery lifecycle updates owned by Runtime wake commits. */

import type { RuntimeStoreTransaction } from "../store";
import type { SignalDeliveryRecord } from "./records";
import type { WorkItem } from "../engine/work";
import { signalDeliveryId } from "./identity";

type SettledSignalDeliveryState = Extract<
  SignalDeliveryRecord["state"],
  "pending" | "delivered" | "failed" | "dead-letter"
>;

/** Record one consumer attempt for Signal deliveries carried by Flow work. */
export async function recordSignalDeliveryAttempt(
  tx: RuntimeStoreTransaction,
  work: WorkItem,
  state: SettledSignalDeliveryState,
  updatedAt: Date,
  options: { readonly settleAllPredicateCandidates?: boolean } = {},
): Promise<void> {
  if (work.work.kind !== "flow.resume") return;
  const signals = tx.signals;
  if (!signals) return;
  const snapshot = await tx.state.getSnapshot(work.work.flowId, {
    namespace: work.namespace,
  });
  const deliveryIds = new Set(
    (snapshot?.pendingSuspends ?? []).flatMap((suspend) => {
      const deliveryKey = suspend.deliveryKey ?? suspend.label;
      const candidates = suspend.candidates ?? [];
      const delivered =
        suspend.delivered ?? snapshot?.deliveredSuspends?.[deliveryKey];
      const selected =
        candidates.length > 0
          ? options.settleAllPredicateCandidates
            ? candidates
            : candidates.slice(0, 1)
          : delivered
            ? [delivered]
            : [];
      const waiterId = suspend.waiterId;
      return waiterId
        ? selected.map((candidate) =>
            signalDeliveryId(candidate.eventId, waiterId),
          )
        : [];
    }),
  );
  for (const deliveryId of deliveryIds) {
    const delivery = await signals.getDelivery(work.namespace, deliveryId);
    if (!delivery || delivery.state !== "pending") continue;
    await signals.putDelivery(
      Object.freeze({
        ...delivery,
        state,
        attempts: delivery.attempts + 1,
        updatedAt: updatedAt.toISOString(),
      }),
    );
  }
}
