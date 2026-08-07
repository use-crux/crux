/**
 * Agent Session delivery fan-out and pending-delivery replay for Signal publish.
 *
 * @module
 */

import type { RuntimeSessionSubscriptionRecord } from "../../ports/sessions";
import type {
  SignalDeliveryRecord,
  SignalOccurrenceRecord,
} from "../../reactive/records";
import {
  sessionSubscriptionDeliveryId,
} from "../../reactive/identity";
import type { RuntimeStoreTransaction } from "../../store";
import { queueAgentSessionSignalIngress } from "./signal-session-ingress";

/**
 * Re-queue still-pending Agent Session deliveries for a replayed occurrence.
 *
 * @remarks Used when publish hits an idempotent occurrence replay so restart
 * recovery re-arms worker validation without double-accepting Flow waiters.
 */
export async function requeuePendingAgentSessionDeliveries(
  tx: RuntimeStoreTransaction,
  occurrence: SignalOccurrenceRecord,
  deliveries: readonly SignalDeliveryRecord[],
): Promise<void> {
  for (const delivery of deliveries) {
    if (delivery.consumer.kind !== "session.subscription") continue;
    if (delivery.state !== "pending") continue;
    const subscription = await tx.sessions?.getSubscription?.(
      occurrence.namespace,
      delivery.consumer.sessionId,
      delivery.consumer.subscriptionId,
    );
    if (!subscription) continue;
    await queueAgentSessionSignalIngress(tx, {
      occurrence,
      subscription,
      delivery,
      now: new Date(occurrence.acceptedAt),
    });
  }
}

/**
 * Accept or reuse one Session-subscription delivery and queue Agent ingress.
 *
 * @returns The durable delivery record (existing or newly written).
 */
export async function acceptSessionSubscriptionDelivery(
  tx: RuntimeStoreTransaction,
  occurrence: SignalOccurrenceRecord,
  subscription: RuntimeSessionSubscriptionRecord,
): Promise<SignalDeliveryRecord> {
  const session = await tx.sessions?.get(
    occurrence.namespace,
    subscription.sessionId,
  );
  const isAgentSession = session?.targetKind === "agent";
  const delivery = sessionSubscriptionDelivery(occurrence, subscription, {
    // Agent Sessions defer validation to the worker; Flow keeps publish-time delivery.
    pending: isAgentSession === true,
  });
  const existing = await tx.signals?.getDelivery(
    occurrence.namespace,
    delivery.deliveryId,
  );
  if (existing) {
    if (existing.state === "pending" && isAgentSession) {
      await queueAgentSessionSignalIngress(tx, {
        occurrence,
        subscription,
        delivery: existing,
        now: new Date(occurrence.acceptedAt),
      });
    }
    return existing;
  }
  await tx.signals?.putDelivery(delivery);
  if (isAgentSession) {
    await queueAgentSessionSignalIngress(tx, {
      occurrence,
      subscription,
      delivery,
      now: new Date(occurrence.acceptedAt),
    });
  }
  return delivery;
}

function sessionSubscriptionDelivery(
  occurrence: SignalOccurrenceRecord,
  subscription: RuntimeSessionSubscriptionRecord,
  options: { readonly pending: boolean },
): SignalDeliveryRecord {
  return Object.freeze({
    schemaVersion: 1,
    namespace: occurrence.namespace,
    deliveryId: sessionSubscriptionDeliveryId(
      occurrence.occurrenceId,
      subscription.subscriptionId,
    ),
    occurrenceId: occurrence.occurrenceId,
    consumer: Object.freeze({
      kind: "session.subscription" as const,
      sessionId: subscription.sessionId,
      subscriptionId: subscription.subscriptionId,
    }),
    // Agent Sessions: pending until the program-authoritative worker validates.
    // Flow Sessions: delivery completes at publish (waiter path is independent).
    state: options.pending ? ("pending" as const) : ("delivered" as const),
    attempts: options.pending ? 0 : 1,
    updatedAt: occurrence.acceptedAt,
  });
}
