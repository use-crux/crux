/**
 * Durable Signal publication composite.
 *
 * @module
 */

import type { JsonObject, JsonValue } from "../../../storage";
import { canonicalSignalJson } from "../../../signal/canonical-json";
import { SignalError } from "../../../signal/errors";
import type { RuntimeSessionSubscriptionRecord } from "../../ports/sessions";
import type {
  RuntimeSignalStorePort,
  SignalDeliveryRecord,
  SignalOccurrenceRecord,
} from "../../reactive/records";
import {
  sessionSubscriptionDeliveryId,
  signalDeliveryId,
} from "../../reactive/identity";
import {
  decodeSignalPayload,
  encodeSignalPayload,
  SIGNAL_PAYLOAD_CODEC,
} from "../../reactive/payload-codec";
import type { RuntimeStoreTransaction } from "../../store";
import type { RuntimeCompositeDeps } from "../composites";
import { emitEventInTransaction } from "../kernel-events";
import { createRuntimeError } from "../errors";
import {
  isFlowSignalWaiter,
  resolveDurableSignalConsumers,
  type DurableSignalConsumers,
} from "./signal-session-consumers";
import type { RuntimeWaiter } from "../../ports/waiters";

/** Input accepted by the atomic `signal.publish` composite. */
export interface SignalPublishCompositeInput {
  /** Runtime namespace that owns every accepted record. */
  readonly namespace: string;
  /** Kernel-allocated stable occurrence identity. */
  readonly occurrenceId: string;
  /** Application-authored Signal identity. */
  readonly signalId: string;
  /** Validated, detached JSON payload. */
  readonly payload: JsonValue;
  /** ISO timestamp for the acceptance boundary. */
  readonly acceptedAt: string;
  /** Versioned hash used for idempotent lookup without storing the raw key. */
  readonly idempotencyHash?: string;
  /** Captured execution origin used to enforce cross-subsystem isolation. */
  readonly executionScope?: "eval";
}

/**
 * Result of atomically resolving and accepting one Signal publication.
 *
 * @remarks `accepted: false` means no durable binding participated and the
 * caller may perform an honest process-local acceptance instead.
 */
export type SignalPublishCompositeResult =
  | { readonly accepted: false }
  | {
      readonly accepted: true;
      readonly occurrence: SignalOccurrenceRecord;
      readonly deliveries: readonly SignalDeliveryRecord[];
      readonly replayed: boolean;
      readonly outboxCount: number;
    };

/**
 * Commit one occurrence plus every required Flow and Session delivery, or neither.
 *
 * @remarks Flow waiters remain an independent consumer. Session-owned Flow
 * waiters only receive durable delivery when a matching active Session
 * subscription also matches the payload. Session subscriptions fan out with
 * restart-safe per-subscription delivery identities.
 */
export async function publishSignalInTransaction(
  tx: RuntimeStoreTransaction,
  deps: RuntimeCompositeDeps,
  input: SignalPublishCompositeInput,
): Promise<SignalPublishCompositeResult> {
  const consumers = await resolveDurableSignalConsumers(tx, input);
  const signals = await signalStoreForPublication(tx, input, consumers);
  if (!signals) return { accepted: false };
  const replay = input.idempotencyHash
    ? await signals.findOccurrenceByIdempotency(
        input.namespace,
        input.signalId,
        input.idempotencyHash,
      )
    : null;
  if (replay) {
    if (
      canonicalSignalJson(
        decodeSignalPayload(replay.payload, replay.payloadCodec),
      ) !== canonicalSignalJson(input.payload)
    ) {
      throw new SignalError(
        "idempotency_conflict",
        `Signal \`${input.signalId}\` rejected idempotency reuse with different normalized payload data.`,
      );
    }
    return {
      accepted: true,
      occurrence: replay,
      deliveries: await signals.listDeliveries(
        replay.namespace,
        replay.occurrenceId,
      ),
      replayed: true,
      outboxCount: 0,
    };
  }

  if (consumers.waiters.length === 0 && consumers.subscriptions.length === 0) {
    return { accepted: false };
  }
  if (input.executionScope === "eval") {
    throw createRuntimeError({
      code: "EVAL_REACTIVE_DISPATCH_FORBIDDEN",
      whatFailed: `Eval execution cannot dispatch Signal \`${input.signalId}\` to a durable consumer.`,
      why: "Durable reactive work started inside an Eval has no isolated execution or evidence contract.",
      whatStillWorks:
        "Process-local Signal publication and ordinary Eval task execution remain available.",
      nextStep:
        "Publish this Signal outside Eval execution, or remove the armed durable consumer before running the Eval.",
    });
  }
  const requiredWaiterIds = new Set(
    consumers.waiters.map((waiter) => waiter.waiterId),
  );

  const occurrence: SignalOccurrenceRecord = Object.freeze({
    schemaVersion: 1,
    namespace: input.namespace,
    occurrenceId: input.occurrenceId,
    signalId: input.signalId,
    payload: encodeSignalPayload(input.payload),
    payloadCodec: SIGNAL_PAYLOAD_CODEC,
    acceptedAt: input.acceptedAt,
    ...(input.idempotencyHash
      ? { idempotencyHash: input.idempotencyHash }
      : {}),
  });
  await signals.putOccurrence(occurrence);

  const deliveries: SignalDeliveryRecord[] = [];
  for (const subscription of consumers.subscriptions) {
    const delivery = sessionSubscriptionDelivery(occurrence, subscription);
    deliveries.push(delivery);
    await signals.putDelivery(delivery);
  }

  const deliveredOccurrence: JsonObject = {
    id: occurrence.occurrenceId,
    signalId: occurrence.signalId,
    payload: occurrence.payload,
    payloadCodec: occurrence.payloadCodec,
    acceptedAt: occurrence.acceptedAt,
  };
  const emitted =
    consumers.waiters.length === 0
      ? { outboxItems: Object.freeze([]) }
      : await emitEventInTransaction(
          tx,
          deps,
          {
            namespace: input.namespace,
            name: input.signalId,
            payload: input.payload,
            eventId: input.occurrenceId,
          },
          {
            deliveryPayload: deliveredOccurrence,
            includeWaiter: (waiter: RuntimeWaiter) =>
              requiredWaiterIds.has(waiter.waiterId),
            onFired: async (waiter: RuntimeWaiter) => {
              if (!isFlowSignalWaiter(waiter)) return;
              const delivery = waiterDelivery(occurrence, waiter);
              deliveries.push(delivery);
              await signals.putDelivery(delivery);
            },
          },
        );

  return {
    accepted: true,
    occurrence,
    deliveries,
    replayed: false,
    outboxCount: emitted.outboxItems.length,
  };
}

async function signalStoreForPublication(
  tx: RuntimeStoreTransaction,
  input: SignalPublishCompositeInput,
  consumers: DurableSignalConsumers,
): Promise<RuntimeSignalStorePort | undefined> {
  if (tx.signals) return tx.signals;
  if (consumers.waiters.length === 0 && consumers.subscriptions.length === 0) {
    return undefined;
  }
  throw new SignalError(
    "publication_rejected",
    `Signal \`${input.signalId}\` requires durable Signal storage for its armed delivery.`,
  );
}

function waiterDelivery(
  occurrence: SignalOccurrenceRecord,
  waiter: RuntimeWaiter & {
    readonly workId: NonNullable<RuntimeWaiter["workId"]>;
    readonly work: { readonly kind: "flow.resume"; readonly flowId: string };
  },
): SignalDeliveryRecord {
  return Object.freeze({
    schemaVersion: 1,
    namespace: occurrence.namespace,
    deliveryId: signalDeliveryId(occurrence.occurrenceId, waiter.waiterId),
    occurrenceId: occurrence.occurrenceId,
    consumer: Object.freeze({
      kind: "flow.signal-wait" as const,
      flowId: waiter.work.flowId,
      waiterId: waiter.waiterId,
      workId: waiter.workId,
    }),
    state: "pending",
    attempts: 0,
    updatedAt: occurrence.acceptedAt,
  });
}

function sessionSubscriptionDelivery(
  occurrence: SignalOccurrenceRecord,
  subscription: RuntimeSessionSubscriptionRecord,
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
    // Session subscription acceptance completes at publish; Flow waiter
    // delivery remains independent and applies only at the wait boundary.
    state: "delivered",
    attempts: 1,
    updatedAt: occurrence.acceptedAt,
  });
}
