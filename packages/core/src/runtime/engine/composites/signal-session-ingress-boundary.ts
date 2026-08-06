/**
 * Step-boundary settlement of pending Agent Session Signal ingress.
 *
 * @module
 */

import type { WorkId } from "../../ports/ids";
import type { RuntimeStoreTransaction } from "../../store";
import { sessionSignalIngressIdentity } from "../session-turn-identity";
import { transition } from "../work";
import { settleAgentSessionSignalIngress } from "./signal-session-ingress-settle";

/**
 * Max pending Agent ingress deliveries settled per Session boundary call.
 *
 * @remarks Settlement prefers `listSessionDeliveries({ state: 'pending' })` so
 * terminal deliveries and unrelated Work never consume this budget. When that
 * port is absent, Work rows are scanned and only pending deliveries count.
 * Residual backlog stays for the next boundary or worker wake (backpressure).
 */
export const SESSION_SIGNAL_INGRESS_SETTLE_LIMIT = 100;

/** Max Work rows scanned when falling back without listSessionDeliveries. */
export const SESSION_SIGNAL_INGRESS_SETTLE_SCAN_CAP = 1_000;

/**
 * Settle every pending Agent Session Signal delivery for one Session.
 *
 * @remarks Prefers pending Session deliveries from the signal port so Work rows
 * left pending after a prior settle cannot exhaust the budget. Falls back to
 * scanning `session.signal-ingress` Work and skipping terminal deliveries
 * without counting them. After a successful settle, cancels residual pending
 * ingress Work so later scans stay unblocked (worker wakes observe stale).
 */
export async function settlePendingAgentSessionSignalIngressForSession(
  tx: RuntimeStoreTransaction,
  input: {
    readonly namespace: string;
    readonly sessionId: string;
    readonly now: Date;
    readonly parseSchema: { parse(input: unknown): unknown } | undefined;
  },
): Promise<void> {
  const signals = tx.signals;
  if (signals?.listSessionDeliveries) {
    const pending = await signals.listSessionDeliveries(
      input.namespace,
      input.sessionId,
      { state: "pending", limit: SESSION_SIGNAL_INGRESS_SETTLE_LIMIT },
    );
    for (const delivery of pending) {
      if (delivery.consumer.kind !== "session.subscription") continue;
      await settleAgentSessionSignalIngress(tx, {
        namespace: input.namespace,
        sessionId: delivery.consumer.sessionId,
        deliveryId: delivery.deliveryId,
        occurrenceId: delivery.occurrenceId,
        subscriptionId: delivery.consumer.subscriptionId,
        now: input.now,
        parseSchema: input.parseSchema,
      });
      await retireIfDeliveryTerminal(tx, input.namespace, delivery.deliveryId);
    }
    return;
  }

  // Fallback: scan Work, skip terminal deliveries without counting against limit.
  let settled = 0;
  let scanned = 0;
  const pageSize = Math.min(50, SESSION_SIGNAL_INGRESS_SETTLE_LIMIT);
  while (
    settled < SESSION_SIGNAL_INGRESS_SETTLE_LIMIT &&
    scanned < SESSION_SIGNAL_INGRESS_SETTLE_SCAN_CAP
  ) {
    const page = await tx.state.listWork({
      namespace: input.namespace,
      status: "pending",
      kind: "session.signal-ingress",
      sessionId: input.sessionId,
      limit: pageSize,
    });
    if (page.length === 0) return;
    let progressed = false;
    for (const work of page) {
      if (work.work.kind !== "session.signal-ingress") continue;
      scanned += 1;
      const delivery = signals
        ? await signals.getDelivery(input.namespace, work.work.deliveryId)
        : null;
      if (
        delivery &&
        (delivery.state === "delivered" || delivery.state === "dead-letter")
      ) {
        await retireSettledIngressWork(
          tx,
          input.namespace,
          work.work.deliveryId,
          work.workId,
        );
        progressed = true;
        continue;
      }
      await settleAgentSessionSignalIngress(tx, {
        namespace: input.namespace,
        sessionId: work.work.sessionId,
        deliveryId: work.work.deliveryId,
        occurrenceId: work.work.occurrenceId,
        subscriptionId: work.work.subscriptionId,
        now: input.now,
        parseSchema: input.parseSchema,
      });
      const retired = await retireIfDeliveryTerminal(
        tx,
        input.namespace,
        work.work.deliveryId,
        work.workId,
      );
      if (retired) {
        settled += 1;
        progressed = true;
      }
      if (settled >= SESSION_SIGNAL_INGRESS_SETTLE_LIMIT) return;
    }
    // Without retire progress the same page would loop forever.
    if (!progressed || page.length < pageSize) return;
  }
}

/** Retire pending ingress Work only when its delivery is already terminal. */
async function retireIfDeliveryTerminal(
  tx: RuntimeStoreTransaction,
  namespace: string,
  deliveryId: string,
  workId?: WorkId,
): Promise<boolean> {
  const delivery = await tx.signals?.getDelivery(namespace, deliveryId);
  if (
    !delivery ||
    (delivery.state !== "delivered" && delivery.state !== "dead-letter")
  ) {
    return false;
  }
  await retireSettledIngressWork(tx, namespace, deliveryId, workId);
  return true;
}

/**
 * Cancel pending ingress Work after delivery settlement so boundary scans do
 * not re-budget terminal deliveries. Worker wakes treat cancelled work as stale.
 */
async function retireSettledIngressWork(
  tx: RuntimeStoreTransaction,
  namespace: string,
  deliveryId: string,
  workId?: WorkId,
): Promise<void> {
  const id =
    workId ?? sessionSignalIngressIdentity(namespace, deliveryId).workId;
  const work = await tx.state.getWork(id, { namespace });
  if (!work || work.status !== "pending") return;
  if (work.work.kind !== "session.signal-ingress") return;
  await tx.state.putWork(transition(work, { status: "cancelled" }));
}
