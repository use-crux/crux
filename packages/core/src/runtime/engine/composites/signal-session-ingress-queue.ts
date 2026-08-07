/**
 * Publish-time Agent Session Signal ingress: accept delivery and enqueue Work.
 *
 * @module
 */

import type { RuntimeSessionSubscriptionRecord } from "../../ports/sessions";
import type {
  SignalDeliveryRecord,
  SignalOccurrenceRecord,
} from "../../reactive/records";
import type { RuntimeStoreTransaction } from "../../store";
import { initialApplicationWorkState } from "../application-work-state";
import { wakeEnvelopeForWork } from "../kernel-shared";
import { sessionSignalIngressIdentity } from "../session-turn-identity";
import type { RuntimeTargetId } from "../../ports/ids";
import {
  appendIngressFacts,
  signalIngressInputId,
} from "./signal-session-ingress-shared";

/**
 * At publish time: accept a pending Agent Session delivery and enqueue worker
 * validation work. Does not validate payload or accept Session input.
 *
 * @remarks Flow Sessions keep delivery-as-delivered at publish. Agent Sessions
 * defer validation to the Runtime worker that holds the immutable program
 * Agent, so missing local schema never aborts unrelated consumers.
 */
export async function queueAgentSessionSignalIngress(
  tx: RuntimeStoreTransaction,
  input: {
    readonly occurrence: SignalOccurrenceRecord;
    readonly subscription: RuntimeSessionSubscriptionRecord;
    readonly delivery: SignalDeliveryRecord;
    readonly now: Date;
  },
): Promise<{
  readonly kind: "queued" | "flow" | "skipped";
  readonly wake: boolean;
}> {
  const sessions = tx.sessions;
  if (!sessions) return { kind: "skipped", wake: false };

  const session = await sessions.get(
    input.occurrence.namespace,
    input.subscription.sessionId,
  );
  if (!session) return { kind: "skipped", wake: false };
  if (session.targetKind !== "agent") {
    return { kind: "flow", wake: false };
  }
  // Closed/killed/deleted: durable delivery still accepted; worker drops without wake.
  if (session.state !== "ready") {
    await appendIngressFacts(tx, {
      namespace: input.occurrence.namespace,
      sessionId: session.sessionId,
      now: input.now,
      facts: [
        {
          kind: "session-input",
          identity: signalIngressInputId(input.delivery.deliveryId),
          outcome: "dropped",
        },
      ],
    });
    // Terminalize delivery now — no worker activation.
    await tx.signals?.putDelivery(
      Object.freeze({
        ...input.delivery,
        state: "dead-letter" as const,
        attempts: input.delivery.attempts + 1,
        updatedAt: input.now.toISOString(),
      }),
    );
    return { kind: "skipped", wake: false };
  }

  const identity = sessionSignalIngressIdentity(
    input.occurrence.namespace,
    input.delivery.deliveryId,
  );
  const existing = await tx.state.getWork(identity.workId, {
    namespace: input.occurrence.namespace,
  });
  if (existing) {
    if (
      existing.status === "pending" ||
      existing.status === "leased" ||
      existing.status === "suspended"
    ) {
      return { kind: "queued", wake: false };
    }
    // Terminal work already settled this delivery.
    return { kind: "queued", wake: false };
  }

  const created = await tx.state.createWork({
    workId: identity.workId,
    namespace: input.occurrence.namespace,
    work: {
      kind: "session.signal-ingress",
      sessionId: session.sessionId,
      deliveryId: input.delivery.deliveryId,
      occurrenceId: input.occurrence.occurrenceId,
      subscriptionId: input.subscription.subscriptionId,
    },
    targetId: session.targetId as RuntimeTargetId,
    idempotencyKey: `session.signal-ingress:${input.delivery.deliveryId}`,
    now: input.now,
  });
  const work = Object.freeze({
    ...created,
    application: initialApplicationWorkState(
      created.workId,
      created.createdAt,
      identity.effects,
    ),
  });
  await tx.state.putWork(work);
  await tx.outbox.put(wakeEnvelopeForWork(work), { deliverAt: input.now });
  return { kind: "queued", wake: true };
}
