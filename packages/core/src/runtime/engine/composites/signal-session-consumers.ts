/** Session subscription matching and Session-owned Flow waiter gating. */

import type { JsonValue } from "../../../storage";
import { matchesSignalData } from "../../../signal/match-runtime";
import { SessionCapabilityError } from "../../../session/errors";
import type { RuntimeWaiter } from "../../ports/waiters";
import type {
  RuntimeSessionStorePort,
  RuntimeSessionSubscriptionRecord,
} from "../../ports/sessions";
import type { RuntimeStoreTransaction } from "../../store";

/** Flow waiter suspended on a durable Signal source with owned Work. */
export type FlowSignalWaiter = RuntimeWaiter & {
  readonly workId: NonNullable<RuntimeWaiter["workId"]>;
  readonly work: { readonly kind: "flow.resume"; readonly flowId: string };
};

export interface DurableSignalConsumers {
  readonly waiters: readonly FlowSignalWaiter[];
  readonly subscriptions: readonly RuntimeSessionSubscriptionRecord[];
}

/** Resolve Flow waiters and matching Session subscriptions for one publication. */
export async function resolveDurableSignalConsumers(
  tx: RuntimeStoreTransaction,
  input: {
    readonly namespace: string;
    readonly signalId: string;
    readonly payload: JsonValue;
  },
): Promise<DurableSignalConsumers> {
  const candidates = await tx.waiters.resolve(input.signalId, input.payload, {
    namespace: input.namespace,
  });
  const flowWaiters = candidates
    .filter(isFlowSignalWaiter)
    .filter((waiter) => signalWaiterMatches(waiter, input.payload));
  const subscriptions = await matchingSessionSubscriptions(tx, input);
  const waiters = await gateSessionOwnedWaiters(
    tx,
    input.namespace,
    flowWaiters,
    subscriptions,
  );
  return Object.freeze({ waiters, subscriptions });
}

export function isFlowSignalWaiter(
  waiter: RuntimeWaiter,
): waiter is FlowSignalWaiter {
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

async function matchingSessionSubscriptions(
  tx: RuntimeStoreTransaction,
  input: {
    readonly namespace: string;
    readonly signalId: string;
    readonly payload: JsonValue;
  },
): Promise<readonly RuntimeSessionSubscriptionRecord[]> {
  const sessions = tx.sessions;
  if (!sessions) return Object.freeze([]);
  requireSessionSubscriptionCapability(sessions);
  const active = await sessions.listActiveSubscriptionsForSignal(
    input.namespace,
    input.signalId,
  );
  return Object.freeze(
    active.filter((subscription) =>
      subscription.match === undefined
        ? true
        : matchesSignalData(subscription.match, input.payload),
    ),
  );
}

/**
 * Session-owned Flow waiters require a matching active Session subscription.
 * Independent non-Session Flow waiters continue without a subscription.
 */
async function gateSessionOwnedWaiters(
  tx: RuntimeStoreTransaction,
  namespace: string,
  waiters: readonly FlowSignalWaiter[],
  subscriptions: readonly RuntimeSessionSubscriptionRecord[],
): Promise<readonly FlowSignalWaiter[]> {
  const sessions = tx.sessions;
  if (!sessions) return waiters;
  requireSessionSubscriptionCapability(sessions);
  const allowed: FlowSignalWaiter[] = [];
  for (const waiter of waiters) {
    const session = await sessions.getByActivationWorkId(
      namespace,
      waiter.workId,
    );
    if (!session) {
      allowed.push(waiter);
      continue;
    }
    const subscribed = subscriptions.some(
      (subscription) => subscription.sessionId === session.sessionId,
    );
    if (subscribed) allowed.push(waiter);
  }
  return Object.freeze(allowed);
}

/**
 * Session storage is all-or-nothing for subscription and activation lookup.
 * Partial ports must fail closed rather than silently skip fan-out or gating.
 */
function requireSessionSubscriptionCapability(
  sessions: RuntimeSessionStorePort,
): void {
  if (
    typeof sessions.listActiveSubscriptionsForSignal !== "function" ||
    typeof sessions.getByActivationWorkId !== "function"
  ) {
    throw new SessionCapabilityError();
  }
}
