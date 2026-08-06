/** Durable Flow Session Signal subscription helpers. */

import type { ResolvedRuntimeEngine } from "../runtime/api/create-runtime";
import type { RuntimeSessionRecord } from "../runtime/ports/sessions";
import {
  isStaticSignalSource,
  signalSourceId,
  signalSourceMatch,
  signalSourcePredicate,
} from "../signal/source";
import { SessionCapabilityError, SessionInputError } from "./errors";
import type { SessionSubscription } from "./target-types";
import { sha256Hex } from "../content/sha256";
import {
  sessionSubscriptionMatchKey,
  sessionSubscriptionMatchValue,
} from "./subscription-match";

const encoder = new TextEncoder();

/**
 * Persist or reuse one durable Signal subscription for a Flow Session.
 *
 * @remarks Idempotent by Session, Signal identity, and canonical match key.
 * Active subscriptions participate in Signal publication fan-out and gate
 * durable delivery to Session-owned Flow waiters. Unsubscribe marks the
 * subscription inactive for future publications; already accepted deliveries
 * remain on the occurrence ledger.
 */
export async function subscribeSession(
  runtime: ResolvedRuntimeEngine,
  record: RuntimeSessionRecord,
  source: unknown,
): Promise<SessionSubscription> {
  if (!isStaticSignalSource(source)) {
    throw new SessionInputError(
      "Session.subscribe() accepts only a Signal or match filter.",
    );
  }
  if (signalSourcePredicate(source)) {
    throw new SessionInputError(
      "Session.subscribe() rejects predicate Signal views. Use signal.when({ ...match }) or a bare Signal definition.",
    );
  }
  const sessions = runtime.store.sessions;
  if (!sessions) {
    throw subscriptionCapabilityError();
  }
  const signalId = signalSourceId(source);
  const match = sessionSubscriptionMatchValue(signalSourceMatch(source));
  const matchKey = sessionSubscriptionMatchKey(match);
  const subscriptionId = `subscription_${identityHash(
    runtime.namespace,
    record.sessionId,
    signalId,
    matchKey,
  )}`;
  const stored = await runtime.store.transact(async (tx) => {
    const port = tx.sessions;
    if (!port) throw subscriptionCapabilityError();
    return port.upsertSubscription({
      namespace: runtime.namespace,
      sessionId: record.sessionId,
      subscriptionId,
      signalId,
      ...(match === undefined ? {} : { match }),
      matchKey,
      now: runtime.now(),
    });
  });
  return subscriptionHandle(
    runtime,
    record.sessionId,
    stored.subscriptionId,
    stored.signalId,
    stored.match,
  );
}

/** List active durable Signal subscriptions for one Session. */
export async function listSessionSubscriptions(
  runtime: ResolvedRuntimeEngine,
  record: RuntimeSessionRecord,
): Promise<readonly SessionSubscription[]> {
  const sessions = runtime.store.sessions;
  if (!sessions) {
    throw subscriptionCapabilityError();
  }
  const listed = await sessions.listSubscriptions(
    runtime.namespace,
    record.sessionId,
  );
  return Object.freeze(
    listed.map((subscription) =>
      subscriptionHandle(
        runtime,
        record.sessionId,
        subscription.subscriptionId,
        subscription.signalId,
        subscription.match,
      ),
    ),
  );
}

function subscriptionHandle(
  runtime: ResolvedRuntimeEngine,
  sessionId: string,
  subscriptionId: string,
  signalId: string,
  match: SessionSubscription["match"],
): SessionSubscription {
  return Object.freeze({
    id: subscriptionId,
    signalId,
    ...(match === undefined ? {} : { match }),
    async unsubscribe() {
      const sessions = runtime.store.sessions;
      if (!sessions) throw subscriptionCapabilityError();
      await runtime.store.transact(async (tx) => {
        const port = tx.sessions;
        if (!port) throw subscriptionCapabilityError();
        await port.unsubscribe(
          runtime.namespace,
          sessionId,
          subscriptionId,
          runtime.now(),
        );
      });
    },
  });
}

function identityHash(...parts: readonly string[]): string {
  return sha256Hex(
    encoder.encode(JSON.stringify(["crux-session:v1", ...parts])),
  );
}

function subscriptionCapabilityError(): Error {
  return new SessionCapabilityError();
}
