/**
 * Bounded observability delivery queue operations.
 *
 * @internal
 * @module
 */

import type { CruxGraphRecord } from "../contract";
import { queuedRecordBytes } from "./bytes";
import {
  publishDeliveryDiagnostics,
  type DeliveryState,
} from "./state";

/** Requeue retryable records in original order at the front of the queue. */
export function requeueDeliveryRecords(
  state: DeliveryState,
  records: readonly CruxGraphRecord[],
): void {
  const items = records.map((record) => ({
    record,
    bytes: queuedRecordBytes(record),
  }));
  state.queue.unshift(...items);
  state.queuedBytes += items.reduce((sum, item) => sum + item.bytes, 0);
  trimDeliveryQueue(state);
}

/** Enforce the shared record and byte bounds, dropping oldest queued rows. */
export function trimDeliveryQueue(state: DeliveryState): void {
  let droppedAny = false;
  while (
    state.pendingRecordCount + state.queue.length >
      state.options.maxQueuedRecords ||
    state.pendingBytes + state.queuedBytes > state.options.maxQueuedBytes
  ) {
    const dropped = state.queue.shift();
    if (!dropped) return;
    state.queuedBytes -= dropped.bytes;
    state.overflowDropped += 1;
    state.overflowDroppedBytes += dropped.bytes;
    droppedAny = true;
  }
  if (droppedAny) publishDeliveryDiagnostics(state);
}
