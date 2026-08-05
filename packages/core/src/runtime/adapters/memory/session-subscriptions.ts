/** In-memory Session Signal subscription persistence. */

import {
  sessionSubscriptionMatchKey,
  sessionSubscriptionMatchValue,
} from "../../../session/subscription-match";
import type {
  RuntimeSessionSubscriptionRecord,
  UpsertRuntimeSessionSubscriptionInput,
} from "../../ports/sessions";
import type { MemoryRuntimeData, MemoryWriteRecorder } from "./data";
import { scopedKey } from "./data";

/** Create or reactivate one durable Session Signal subscription. */
export function upsertMemorySessionSubscription(
  data: MemoryRuntimeData,
  input: UpsertRuntimeSessionSubscriptionInput,
  recordWrite?: MemoryWriteRecorder,
): RuntimeSessionSubscriptionRecord {
  const session = data.sessionsById.get(
    scopedKey(input.namespace, input.sessionId),
  );
  if (!session) {
    throw new Error(`Session "${input.sessionId}" was not found.`);
  }
  const match = sessionSubscriptionMatchValue(input.match);
  const matchKey = sessionSubscriptionMatchKey(match);
  const existing = [...data.sessionSubscriptions.values()].find(
    (subscription) =>
      subscription.namespace === input.namespace &&
      subscription.sessionId === input.sessionId &&
      subscription.signalId === input.signalId &&
      subscription.matchKey === matchKey,
  );
  if (existing) {
    if (existing.state === "active") return existing;
    const reactivated = Object.freeze({
      ...existing,
      state: "active" as const,
      updatedAt: input.now.toISOString(),
    });
    data.sessionSubscriptions.set(
      scopedKey(input.namespace, existing.subscriptionId),
      reactivated,
    );
    recordWrite?.();
    return reactivated;
  }
  const created: RuntimeSessionSubscriptionRecord = Object.freeze({
    schemaVersion: 1,
    namespace: input.namespace,
    sessionId: input.sessionId,
    subscriptionId: input.subscriptionId,
    signalId: input.signalId,
    ...(match === undefined ? {} : { match }),
    matchKey,
    state: "active",
    createdAt: input.now.toISOString(),
    updatedAt: input.now.toISOString(),
  });
  data.sessionSubscriptions.set(
    scopedKey(input.namespace, created.subscriptionId),
    created,
  );
  recordWrite?.();
  return created;
}

export function getMemorySessionSubscription(
  data: MemoryRuntimeData,
  namespace: string,
  sessionId: string,
  subscriptionId: string,
): RuntimeSessionSubscriptionRecord | null {
  const subscription = data.sessionSubscriptions.get(
    scopedKey(namespace, subscriptionId),
  );
  return subscription?.sessionId === sessionId ? subscription : null;
}

export function listMemorySessionSubscriptions(
  data: MemoryRuntimeData,
  namespace: string,
  sessionId: string,
): readonly RuntimeSessionSubscriptionRecord[] {
  return Object.freeze(
    [...data.sessionSubscriptions.values()].filter(
      (subscription) =>
        subscription.namespace === namespace &&
        subscription.sessionId === sessionId &&
        subscription.state === "active",
    ),
  );
}

export function listMemoryActiveSubscriptionsForSignal(
  data: MemoryRuntimeData,
  namespace: string,
  signalId: string,
): readonly RuntimeSessionSubscriptionRecord[] {
  return Object.freeze(
    [...data.sessionSubscriptions.values()].filter(
      (subscription) =>
        subscription.namespace === namespace &&
        subscription.signalId === signalId &&
        subscription.state === "active",
    ),
  );
}

export function unsubscribeMemorySessionSubscription(
  data: MemoryRuntimeData,
  namespace: string,
  sessionId: string,
  subscriptionId: string,
  now: Date,
  recordWrite?: MemoryWriteRecorder,
): RuntimeSessionSubscriptionRecord {
  const key = scopedKey(namespace, subscriptionId);
  const subscription = data.sessionSubscriptions.get(key);
  if (!subscription || subscription.sessionId !== sessionId) {
    throw new Error(`Session subscription "${subscriptionId}" was not found.`);
  }
  if (subscription.state === "unsubscribed") return subscription;
  const updated = Object.freeze({
    ...subscription,
    state: "unsubscribed" as const,
    updatedAt: now.toISOString(),
  });
  data.sessionSubscriptions.set(key, updated);
  recordWrite?.();
  return updated;
}
