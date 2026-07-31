import type {
  RuntimeSignalStorePort,
  SignalDeliveryRecord,
  SignalOccurrenceRecord,
  SignalSubscriptionRecord,
} from "../../reactive/records";
import type { MemoryRuntimeData, MemoryWriteRecorder } from "./data";
import { scopedKey } from "./data";
import { cloneJsonValue } from "./json";

export function createMemorySignalStore(
  data: MemoryRuntimeData,
  recordWrite?: MemoryWriteRecorder,
): RuntimeSignalStorePort {
  return {
    async getOccurrence(namespace, occurrenceId) {
      const record = data.signalOccurrences.get(
        scopedKey(namespace, occurrenceId),
      );
      return record ? cloneOccurrence(record) : null;
    },
    async findOccurrenceByIdempotency(namespace, signalId, idempotencyHash) {
      const occurrenceId = data.signalIdempotency.get(
        scopedKey(namespace, `${signalId}\0${idempotencyHash}`),
      );
      if (!occurrenceId) return null;
      const record = data.signalOccurrences.get(
        scopedKey(namespace, occurrenceId),
      );
      return record ? cloneOccurrence(record) : null;
    },
    async putOccurrence(record) {
      recordWrite?.();
      data.signalOccurrences.set(
        scopedKey(record.namespace, record.occurrenceId),
        cloneOccurrence(record),
      );
      if (record.idempotencyHash) {
        data.signalIdempotency.set(
          scopedKey(
            record.namespace,
            `${record.signalId}\0${record.idempotencyHash}`,
          ),
          record.occurrenceId,
        );
      }
    },
    async getDelivery(namespace, deliveryId) {
      const record = data.signalDeliveries.get(
        scopedKey(namespace, deliveryId),
      );
      return record ? cloneDelivery(record) : null;
    },
    async listDeliveries(namespace, occurrenceId) {
      return [...data.signalDeliveries.values()]
        .filter(
          (delivery) =>
            delivery.namespace === namespace &&
            delivery.occurrenceId === occurrenceId,
        )
        .map(cloneDelivery);
    },
    async putDelivery(record) {
      recordWrite?.();
      data.signalDeliveries.set(
        scopedKey(record.namespace, record.deliveryId),
        cloneDelivery(record),
      );
    },
    async putSubscription(record) {
      recordWrite?.();
      data.signalSubscriptions.set(
        scopedKey(record.namespace, record.subscriptionId),
        cloneSubscription(record),
      );
    },
  };
}

function cloneOccurrence(
  record: SignalOccurrenceRecord,
): SignalOccurrenceRecord {
  return Object.freeze({
    ...record,
    payload: cloneJsonValue(record.payload, "Signal occurrence payload"),
    ...(record.source ? { source: Object.freeze({ ...record.source }) } : {}),
  });
}

function cloneDelivery(record: SignalDeliveryRecord): SignalDeliveryRecord {
  return Object.freeze({
    ...record,
    consumer: Object.freeze({ ...record.consumer }),
  });
}

function cloneSubscription(
  record: SignalSubscriptionRecord,
): SignalSubscriptionRecord {
  return Object.freeze({
    ...record,
    ...(record.match === undefined
      ? {}
      : { match: cloneJsonValue(record.match, "Signal subscription match") }),
  });
}
