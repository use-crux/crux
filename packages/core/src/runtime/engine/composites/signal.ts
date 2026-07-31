/**
 * Durable Signal publication composite.
 *
 * @module
 */

import type { JsonObject, JsonValue } from "../../../storage";
import { canonicalSignalJson } from "../../../signal/canonical-json";
import { SignalError } from "../../../signal/errors";
import { matchesSignalData } from "../../../signal/match-runtime";
import type { RuntimeWaiter } from "../../ports/waiters";
import type {
  RuntimeSignalStorePort,
  SignalDeliveryRecord,
  SignalOccurrenceRecord,
} from "../../reactive/records";
import { signalDeliveryId } from "../../reactive/identity";
import type { RuntimeStoreTransaction } from "../../store";
import type { RuntimeCompositeDeps } from "../composites";
import { emitEventInTransaction } from "../kernel-events";

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

/** Commit one occurrence plus every required Flow delivery, or neither. */
export async function publishSignalInTransaction(
  tx: RuntimeStoreTransaction,
  deps: RuntimeCompositeDeps,
  input: SignalPublishCompositeInput,
): Promise<SignalPublishCompositeResult> {
  const signals = await signalStoreForPublication(tx, input);
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
      canonicalSignalJson(replay.payload) !== canonicalSignalJson(input.payload)
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

  const candidates = await tx.waiters.resolve(input.signalId, input.payload, {
    namespace: input.namespace,
  });
  const required = candidates
    .filter(isFlowSignalWaiter)
    .filter((waiter) => signalWaiterMatches(waiter, input.payload));
  if (required.length === 0) return { accepted: false };
  const requiredWaiterIds = new Set(required.map((waiter) => waiter.waiterId));

  const occurrence: SignalOccurrenceRecord = Object.freeze({
    schemaVersion: 1,
    namespace: input.namespace,
    occurrenceId: input.occurrenceId,
    signalId: input.signalId,
    payload: input.payload,
    acceptedAt: input.acceptedAt,
    ...(input.idempotencyHash
      ? { idempotencyHash: input.idempotencyHash }
      : {}),
  });
  await signals.putOccurrence(occurrence);

  const deliveries: SignalDeliveryRecord[] = [];
  const deliveredOccurrence: JsonObject = {
    id: occurrence.occurrenceId,
    signalId: occurrence.signalId,
    payload: occurrence.payload,
    acceptedAt: occurrence.acceptedAt,
  };
  const emitted = await emitEventInTransaction(
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
      includeWaiter: (waiter) => requiredWaiterIds.has(waiter.waiterId),
      onFired: async (waiter) => {
        if (!isFlowSignalWaiter(waiter)) return;
        const delivery = deliveryFor(occurrence, waiter);
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
): Promise<RuntimeSignalStorePort | undefined> {
  if (tx.signals) return tx.signals;
  const required = (await tx.waiters.resolve(input.signalId, input.payload, {
    namespace: input.namespace,
  }))
    .filter(isFlowSignalWaiter)
    .filter((waiter) => signalWaiterMatches(waiter, input.payload));
  if (required.length === 0) return undefined;
  throw new SignalError(
    "publication_rejected",
    `Signal \`${input.signalId}\` requires durable Signal storage for its armed Flow delivery.`,
  );
}

type FlowSignalWaiter = RuntimeWaiter & {
  readonly workId: NonNullable<RuntimeWaiter["workId"]>;
  readonly work: { readonly kind: "flow.resume"; readonly flowId: string };
};

function isFlowSignalWaiter(waiter: RuntimeWaiter): waiter is FlowSignalWaiter {
  return (
    waiter.source?.kind === "signal" &&
    waiter.source.signalId === waiter.eventName &&
    waiter.workId !== undefined &&
    waiter.work.kind === "flow.resume"
  );
}

function signalWaiterMatches(
  waiter: FlowSignalWaiter,
  payload: JsonValue,
): boolean {
  const match = waiter.source?.match;
  return match === undefined || matchesSignalData(match, payload);
}

function deliveryFor(
  occurrence: SignalOccurrenceRecord,
  waiter: FlowSignalWaiter,
): SignalDeliveryRecord {
  return Object.freeze({
    schemaVersion: 1,
    namespace: occurrence.namespace,
    deliveryId: signalDeliveryId(
      occurrence.occurrenceId,
      waiter.waiterId,
    ),
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
