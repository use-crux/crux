/** Memory-adapter cloning for durable predicate candidate queues. */

import type { JsonValue } from "../../../storage";
import type {
  MarkSnapshotDeliveredOptions,
  RuntimeDeliveredSuspend,
  RuntimePendingSuspend,
} from "../../ports/state";
import { cloneJsonValue } from "./json";

function clonePredicateSuspendFields(
  suspend: RuntimePendingSuspend,
): Pick<RuntimePendingSuspend, "signalPredicate" | "candidates"> {
  return {
    signalPredicate: suspend.signalPredicate,
    candidates: suspend.candidates?.map((candidate, index) =>
      cloneMemoryDeliveredSuspend(
        candidate,
        `flow snapshot pendingSuspends.${suspend.label}.candidates.${index}.payload`,
      ),
    ),
  };
}

/** Clone one pending suspend, including legacy payload-less deliveries. */
export function cloneMemoryPendingSuspend(
  suspend: RuntimePendingSuspend,
): RuntimePendingSuspend {
  return Object.freeze({
    label: suspend.label,
    deliveryKey: suspend.deliveryKey,
    waiterId: suspend.waiterId,
    timerId: suspend.timerId,
    timeoutAt: suspend.timeoutAt ? new Date(suspend.timeoutAt) : undefined,
    ...clonePredicateSuspendFields(suspend),
    delivered: suspend.delivered
      ? cloneMemoryDeliveredSuspend(
          suspend.delivered,
          `flow snapshot pendingSuspends.${suspend.label}.delivered.payload`,
        )
      : undefined,
  });
}

/** Clone one delivered suspend through the memory adapter JSON boundary. */
export function cloneMemoryDeliveredSuspend(
  delivery: RuntimeDeliveredSuspend,
  path: string,
): RuntimeDeliveredSuspend {
  const payload = (
    delivery as RuntimeDeliveredSuspend & { readonly payload?: JsonValue }
  ).payload;
  if (payload === undefined) {
    return { eventId: delivery.eventId } as unknown as RuntimeDeliveredSuspend;
  }
  return {
    eventId: delivery.eventId,
    payload: cloneJsonValue(payload, path),
  };
}

/** Return one cloned suspend with a candidate appended to its FIFO. */
export function appendPredicateCandidate(
  suspend: RuntimePendingSuspend,
  options: MarkSnapshotDeliveredOptions,
): RuntimePendingSuspend {
  return Object.freeze({
    label: suspend.label,
    deliveryKey: suspend.deliveryKey,
    waiterId: suspend.waiterId,
    timerId: suspend.timerId,
    timeoutAt: suspend.timeoutAt ? new Date(suspend.timeoutAt) : undefined,
    signalPredicate: true,
    candidates: [
      ...(suspend.candidates ?? []).map((candidate, index) =>
        cloneMemoryDeliveredSuspend(
          candidate,
          `flow snapshot pendingSuspends.${suspend.label}.candidates.${index}.payload`,
        ),
      ),
      {
        eventId: options.eventId,
        payload: cloneJsonValue(
          options.payload,
          "flow snapshot delivered payload",
        ),
      },
    ],
  });
}
