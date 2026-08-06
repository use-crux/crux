/**
 * Worker settlement of one Agent Session Signal ingress delivery.
 *
 * @module
 */

import type { JsonObject } from "../../../storage";
import type { StatisticsFact } from "../../../statistics";
import { parseAgentSessionInputWithSchema } from "../../../session/agent-input-schema";
import type { SignalDeliveryRecord } from "../../reactive/records";
import type { RuntimeStoreTransaction } from "../../store";
import { appendSessionIngressAcceptedEvent } from "../session-events";
import { decodeSignalPayload } from "../../reactive/payload-codec";
import { reserveNextSessionActivation } from "./session-activation";
import {
  appendIngressFacts,
  signalIngressInputId,
  type SessionSignalIngressOutcome,
} from "./signal-session-ingress-shared";

/**
 * Validate with the program Agent schema, then accept or drop.
 *
 * @remarks CAS winner of `pending → leased` owns accept/stats/events then
 * `leased → delivered|dead-letter`. Delivery is never terminalized before those
 * writes commit in the same transaction.
 */
export async function settleAgentSessionSignalIngress(
  tx: RuntimeStoreTransaction,
  input: {
    readonly namespace: string;
    readonly sessionId: string;
    readonly deliveryId: string;
    readonly occurrenceId: string;
    readonly subscriptionId: string;
    readonly now: Date;
    readonly parseSchema: { parse(input: unknown): unknown } | undefined;
  },
): Promise<SessionSignalIngressOutcome> {
  const sessions = tx.sessions;
  const signals = tx.signals;
  if (!sessions || !signals) {
    return { kind: "dropped", reason: "unavailable" };
  }

  const inputId = signalIngressInputId(input.deliveryId);
  const delivery = await signals.getDelivery(input.namespace, input.deliveryId);
  if (!delivery) {
    return { kind: "dropped", reason: "unavailable" };
  }
  if (delivery.state === "delivered" || delivery.state === "dead-letter") {
    return terminalDeliveryOutcome(sessions, input, inputId);
  }
  // Another settler holds the lease. If input already exists they finished
  // accept; otherwise throw so the worker retries after the winner commits.
  if (delivery.state === "leased") {
    const existing = await sessions.getInput(
      input.namespace,
      input.sessionId,
      inputId,
    );
    if (existing) {
      return { kind: "deduplicated", inputId };
    }
    throw new Error(
      "Agent Session Signal ingress settlement is already claimed.",
    );
  }
  if (delivery.state !== "pending") {
    return { kind: "dropped", reason: "invalid" };
  }

  const session = await sessions.get(input.namespace, input.sessionId);
  if (!session || session.state !== "ready") {
    const claimed = await claimDelivery(tx, delivery, "leased", input.now);
    if (!claimed) {
      return terminalDeliveryOutcome(sessions, input, inputId);
    }
    if (session) {
      await appendIngressFacts(tx, {
        namespace: input.namespace,
        sessionId: input.sessionId,
        now: input.now,
        facts: [
          { kind: "session-input", identity: inputId, outcome: "dropped" },
        ],
      });
    }
    await finishDelivery(tx, claimed, "dead-letter", input.now);
    return { kind: "dropped", reason: "closed" };
  }
  if (session.targetKind !== "agent") {
    const claimed = await claimDelivery(tx, delivery, "leased", input.now);
    if (!claimed) {
      return terminalDeliveryOutcome(sessions, input, inputId);
    }
    await finishDelivery(tx, claimed, "delivered", input.now);
    return { kind: "dropped", reason: "flow" };
  }

  const existing = await sessions.getInput(
    input.namespace,
    session.sessionId,
    inputId,
  );
  if (existing) {
    const claimed = await claimDelivery(tx, delivery, "leased", input.now);
    if (claimed) {
      await appendIngressFacts(tx, {
        namespace: input.namespace,
        sessionId: session.sessionId,
        now: input.now,
        facts: [
          { kind: "session-input", identity: inputId, outcome: "deduplicated" },
        ],
      });
      await finishDelivery(tx, claimed, "delivered", input.now);
    }
    return { kind: "deduplicated", inputId };
  }

  // Claim before accept/stats/events so only one settler writes them.
  const claimed = await claimDelivery(tx, delivery, "leased", input.now);
  if (!claimed) {
    return terminalDeliveryOutcome(sessions, input, inputId);
  }

  const occurrence = await signals.getOccurrence(
    input.namespace,
    input.occurrenceId,
  );
  if (!occurrence) {
    await appendIngressFacts(tx, {
      namespace: input.namespace,
      sessionId: session.sessionId,
      now: input.now,
      facts: [
        { kind: "session-input", identity: inputId, outcome: "dropped" },
      ],
    });
    await finishDelivery(tx, claimed, "dead-letter", input.now);
    return { kind: "dropped", reason: "unavailable" };
  }

  const decoded = decodeSignalPayload(
    occurrence.payload,
    occurrence.payloadCodec,
  );
  const validated = parseAgentSessionInputWithSchema(input.parseSchema, decoded);
  if (!validated.ok) {
    await appendIngressFacts(tx, {
      namespace: input.namespace,
      sessionId: session.sessionId,
      now: input.now,
      facts: [
        { kind: "session-input", identity: inputId, outcome: "dropped" },
      ],
    });
    await finishDelivery(tx, claimed, "dead-letter", input.now);
    return {
      kind: "dropped",
      reason: validated.reason === "unavailable" ? "unavailable" : "invalid",
    };
  }
  const payloadObject: JsonObject = validated.value;

  const parked =
    !session.activation &&
    session.pendingInputs === 0 &&
    session.pendingWork === 0;
  const accepted = await sessions.acceptInputs({
    namespace: input.namespace,
    sessionId: session.sessionId,
    inputs: [payloadObject],
    inputIds: [inputId],
    now: input.now,
  });
  const record = accepted[0];
  if (!record) {
    await appendIngressFacts(tx, {
      namespace: input.namespace,
      sessionId: session.sessionId,
      now: input.now,
      facts: [
        { kind: "session-input", identity: inputId, outcome: "dropped" },
      ],
    });
    await finishDelivery(tx, claimed, "dead-letter", input.now);
    return { kind: "dropped", reason: "invalid" };
  }

  // acceptInputs is idempotent; only the CAS winner reaches here, so stats once.
  const facts: StatisticsFact[] = [
    { kind: "session-input", identity: inputId, outcome: "accepted" },
    ...(parked
      ? ([
          {
            kind: "session-input",
            identity: inputId,
            outcome: "resumed",
          },
        ] as const)
      : []),
  ];
  await appendIngressFacts(tx, {
    namespace: input.namespace,
    sessionId: session.sessionId,
    now: input.now,
    facts,
  });
  await appendSessionIngressAcceptedEvent(tx, {
    namespace: input.namespace,
    sessionId: session.sessionId,
    accepted: record,
    source: "signal",
  });
  await reserveNextSessionActivation(tx, {
    namespace: input.namespace,
    sessionId: session.sessionId,
    now: input.now,
  });
  await finishDelivery(tx, claimed, "delivered", input.now);
  return {
    kind: "accepted",
    inputId: record.inputId,
    cursor: record.cursor,
  };
}

async function terminalDeliveryOutcome(
  sessions: NonNullable<RuntimeStoreTransaction["sessions"]>,
  input: {
    readonly namespace: string;
    readonly sessionId: string;
  },
  inputId: string,
): Promise<SessionSignalIngressOutcome> {
  const existing = await sessions.getInput(
    input.namespace,
    input.sessionId,
    inputId,
  );
  if (existing) {
    return { kind: "deduplicated", inputId };
  }
  return { kind: "dropped", reason: "invalid" };
}

async function claimDelivery(
  tx: RuntimeStoreTransaction,
  delivery: SignalDeliveryRecord,
  nextState: "leased",
  now: Date,
): Promise<SignalDeliveryRecord | null> {
  const next = Object.freeze({
    ...delivery,
    state: nextState,
    attempts: delivery.attempts + 1,
    updatedAt: now.toISOString(),
  });
  return await compareAndSetDelivery(tx, delivery, "pending", next);
}

async function finishDelivery(
  tx: RuntimeStoreTransaction,
  leased: SignalDeliveryRecord,
  state: "delivered" | "dead-letter",
  now: Date,
): Promise<void> {
  const next = Object.freeze({
    ...leased,
    state,
    updatedAt: now.toISOString(),
  });
  await compareAndSetDelivery(tx, leased, "leased", next);
}

async function compareAndSetDelivery(
  tx: RuntimeStoreTransaction,
  current: SignalDeliveryRecord,
  expectedState: SignalDeliveryRecord["state"],
  next: SignalDeliveryRecord,
): Promise<SignalDeliveryRecord | null> {
  const signals = tx.signals;
  if (!signals) return null;
  if (signals.compareAndSetDelivery) {
    return await signals.compareAndSetDelivery(
      current.namespace,
      current.deliveryId,
      expectedState,
      next,
    );
  }
  // Fallback when adapter has not implemented CAS: check-then-put in this
  // transaction. Concurrent adapters must still serialize via their store.
  const fresh = await signals.getDelivery(current.namespace, current.deliveryId);
  if (!fresh || fresh.state !== expectedState) return null;
  await signals.putDelivery(next);
  return next;
}
