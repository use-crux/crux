/** Safe public Session events backed by the Runtime durable event port. */

import type { JsonValue } from "../../storage";
import type { RuntimeSessionInputRecord } from "../ports/sessions";
import type { RuntimeStoreTransaction } from "../store";
import { sessionEventStreamName } from "../../session/stream";
import type { SessionStatus } from "../../session/types";

/** Append one ordered Session status event after a durable lifecycle change. */
export async function appendSessionStatusEvent(
  tx: RuntimeStoreTransaction,
  input: {
    readonly namespace: string;
    readonly sessionId: string;
    readonly status: SessionStatus;
    readonly eventId?: string;
  },
): Promise<void> {
  await tx.events.append(
    {
      namespace: input.namespace,
      name: sessionEventStreamName(input.sessionId),
      payload: {
        schemaVersion: 1,
        type: "session.status",
        sessionId: input.sessionId,
        status: statusPayload(input.status),
      },
      ...(input.eventId ? { eventId: input.eventId } : {}),
    },
    input.eventId
      ? { idempotencyKey: `session.status:${input.eventId}` }
      : undefined,
  );
}

/** Append one accepted-ingress event for reconnectable Session streams. */
export async function appendSessionIngressAcceptedEvent(
  tx: RuntimeStoreTransaction,
  input: {
    readonly namespace: string;
    readonly sessionId: string;
    readonly accepted: RuntimeSessionInputRecord;
    readonly source: "send" | "signal";
  },
): Promise<void> {
  await tx.events.append(
    {
      namespace: input.namespace,
      name: sessionEventStreamName(input.sessionId),
      payload: {
        schemaVersion: 1,
        type: "ingress.accepted",
        sessionId: input.sessionId,
        ingress: ingressPayload(input.accepted, input.source),
      },
      eventId: `session.ingress.accepted:${input.accepted.inputId}`,
    },
    {
      idempotencyKey: `session.ingress.accepted:${input.accepted.inputId}`,
    },
  );
}

/** Append one model-visible delivery event at a safe boundary. */
export async function appendSessionIngressDeliveredEvent(
  tx: RuntimeStoreTransaction,
  input: {
    readonly namespace: string;
    readonly sessionId: string;
    readonly accepted: RuntimeSessionInputRecord;
    readonly source: "send" | "signal";
    readonly stepIndex: number;
    /** Canonical Work identity when the claim linked this input to a turn. */
    readonly workId?: string;
  },
): Promise<void> {
  await tx.events.append(
    {
      namespace: input.namespace,
      name: sessionEventStreamName(input.sessionId),
      payload: {
        schemaVersion: 1,
        type: "ingress.delivered",
        sessionId: input.sessionId,
        stepIndex: input.stepIndex,
        ingress: ingressPayload(input.accepted, input.source),
        ...(input.workId ? { workId: input.workId } : {}),
        ...(input.accepted.work
          ? {
              work: {
                workId: input.accepted.work.workId,
                state: input.accepted.work.state,
              },
            }
          : {}),
      },
      eventId: `session.ingress.delivered:${input.accepted.inputId}:${input.stepIndex}`,
    },
    {
      idempotencyKey: `session.ingress.delivered:${input.accepted.inputId}:${input.stepIndex}`,
    },
  );
}

function statusPayload(status: SessionStatus): JsonValue {
  return {
    state: status.state,
    pendingInputs: status.pendingInputs,
    pendingWork: status.pendingWork,
    ...(status.acceptedCursor !== undefined
      ? { acceptedCursor: status.acceptedCursor }
      : {}),
    ...(status.processedCursor !== undefined
      ? { processedCursor: status.processedCursor }
      : {}),
  };
}

function ingressPayload(
  accepted: RuntimeSessionInputRecord,
  source: "send" | "signal",
): JsonValue {
  return {
    inputId: accepted.inputId,
    cursor: String(accepted.cursor),
    source,
  };
}
