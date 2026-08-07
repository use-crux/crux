/** Cursor-backed Session event streaming over the Runtime durable event port. */

import type { JsonValue } from "../storage";
import type { ResolvedRuntimeEngine } from "../runtime/api/create-runtime";
import type { RuntimeEvent } from "../runtime/ports/events";
import type { EventCursor } from "../runtime/ports/ids";
import { waitForDurableWorkChange } from "../work/internal/durable-wait";
import { SessionNotFoundError } from "./errors";
import type { SessionEvent, SessionStreamOptions } from "./events";
import { readSessionStatus } from "./inspection";
import type { SessionStatus } from "./types";

const STREAM_NAME = (sessionId: string) => `crux.session:${sessionId}`;

/**
 * Yield a replacement snapshot followed by safe events for one Session.
 *
 * @remarks Without `after`, emits `session.snapshot` (`initial`) then every
 * retained event from the earliest retained position. A valid `after` resumes
 * strictly after that cursor. An expired/unknown `after` emits
 * `session.snapshot` (`cursor-expired`) then continues from the earliest
 * retained event. Snapshot events replace local reducer state; retained events
 * that follow are authoritative and may restate facts already summarized by
 * the snapshot.
 */
export async function* sessionStream(
  runtime: ResolvedRuntimeEngine,
  sessionId: string,
  options: SessionStreamOptions = {},
): AsyncIterable<SessionEvent> {
  let cursor = options.after as EventCursor | undefined;
  let validateCursor = options.after !== undefined;
  // When true, the next page read starts at the earliest retained event.
  let fromEarliestRetained = false;

  if (!cursor) {
    const status = await readSessionStatus(runtime, sessionId);
    yield snapshotEvent(sessionId, status, "initial");
    fromEarliestRetained = true;
    if (isTerminal(status.state)) {
      // Still drain retained history so reconnect sees the close status event.
    }
  }

  let waitAttempt = 0;
  for (;;) {
    let page = await runtime.store.events.read({
      namespace: runtime.namespace,
      name: STREAM_NAME(sessionId),
      ...(fromEarliestRetained || !cursor ? {} : { after: cursor }),
      limit: 100,
    });
    fromEarliestRetained = false;

    if (validateCursor) {
      validateCursor = false;
      if (page.afterFound === false) {
        const status = await readSessionStatus(runtime, sessionId);
        yield snapshotEvent(sessionId, status, "cursor-expired");
        fromEarliestRetained = true;
        cursor = undefined;
        if (isTerminal(status.state)) {
          // Fall through to drain any retained terminal status events.
        }
        continue;
      }
    }

    for (;;) {
      for (const event of page.events) {
        cursor = event.eventId;
        const decoded = decodeSessionEvent(event, sessionId);
        if (!decoded) continue;
        yield decoded;
        if (
          decoded.type === "session.status" &&
          isTerminal(decoded.status.state)
        ) {
          return;
        }
      }
      if (page.events.length > 0) {
        waitAttempt = 0;
        break;
      }
      const status = await readSessionStatus(runtime, sessionId);
      if (!isTerminal(status.state)) {
        waitAttempt = await waitForDurableWorkChange(waitAttempt);
        break;
      }
      page = await runtime.store.events.read({
        namespace: runtime.namespace,
        name: STREAM_NAME(sessionId),
        ...(cursor ? { after: cursor } : {}),
        limit: 100,
      });
      if (page.events.length === 0) return;
    }
  }
}

function snapshotEvent(
  sessionId: string,
  status: SessionStatus,
  reason: "initial" | "cursor-expired",
): SessionEvent {
  return Object.freeze({
    id: `session.snapshot:${sessionId}:${reason}:${status.state}`,
    cursor: `session.snapshot:${sessionId}:${reason}`,
    sessionId,
    occurredAt: new Date(),
    type: "session.snapshot",
    reason,
    status,
  });
}

function decodeSessionEvent(
  event: RuntimeEvent,
  sessionId: string,
): SessionEvent | undefined {
  if (event.name !== STREAM_NAME(sessionId)) return undefined;
  const payload = record(event.payload);
  if (!payload || payload.schemaVersion !== 1 || payload.sessionId !== sessionId)
    return undefined;
  const base = {
    id: event.eventId,
    cursor: event.eventId,
    sessionId,
    occurredAt: new Date(event.appendedAt),
  };
  if (payload.type === "session.status" && payload.status !== undefined) {
    const status = decodeStatus(payload.status);
    return status
      ? Object.freeze({ ...base, type: "session.status", status })
      : undefined;
  }
  if (payload.type === "ingress.accepted" && payload.ingress !== undefined) {
    const ingress = decodeIngress(payload.ingress);
    return ingress
      ? Object.freeze({ ...base, type: "ingress.accepted", ingress })
      : undefined;
  }
  if (
    payload.type === "ingress.delivered" &&
    payload.ingress !== undefined &&
    typeof payload.stepIndex === "number"
  ) {
    const ingress = decodeIngress(payload.ingress);
    const workRecord =
      payload.work === undefined ? undefined : record(payload.work);
    const workId =
      typeof payload.workId === "string"
        ? payload.workId
        : typeof workRecord?.workId === "string"
          ? workRecord.workId
          : undefined;
    return ingress
      ? Object.freeze({
          ...base,
          type: "ingress.delivered",
          ingress,
          stepIndex: payload.stepIndex,
          ...(typeof workId === "string" ? { workId } : {}),
        })
      : undefined;
  }
  return undefined;
}

function decodeStatus(value: JsonValue): SessionStatus | undefined {
  const status = record(value);
  if (!status || typeof status.state !== "string") return undefined;
  if (typeof status.pendingInputs !== "number") return undefined;
  if (typeof status.pendingWork !== "number") return undefined;
  return Object.freeze({
    state: status.state as SessionStatus["state"],
    ...(typeof status.acceptedCursor === "string"
      ? { acceptedCursor: status.acceptedCursor }
      : {}),
    ...(typeof status.processedCursor === "string"
      ? { processedCursor: status.processedCursor }
      : {}),
    pendingInputs: status.pendingInputs,
    pendingWork: status.pendingWork,
  });
}

function decodeIngress(
  value: JsonValue,
): import("./events").SessionIngressSummary | undefined {
  const ingress = record(value);
  if (!ingress) return undefined;
  if (typeof ingress.inputId !== "string") return undefined;
  if (typeof ingress.cursor !== "string") return undefined;
  if (ingress.source !== "send" && ingress.source !== "signal") return undefined;
  return Object.freeze({
    inputId: ingress.inputId,
    cursor: ingress.cursor,
    source: ingress.source,
  });
}

function record(
  value: JsonValue,
): Record<string, JsonValue | undefined> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, JsonValue | undefined>)
    : undefined;
}

function isTerminal(state: SessionStatus["state"]): boolean {
  return state === "closed";
}

/** @internal re-export for engine append helpers */
export function sessionEventStreamName(sessionId: string): string {
  return STREAM_NAME(sessionId);
}

/** Ensure the Session still exists before streaming. */
export async function requireSessionForStream(
  runtime: ResolvedRuntimeEngine,
  sessionId: string,
): Promise<void> {
  const row = await runtime.store.sessions?.get(runtime.namespace, sessionId);
  if (!row || row.state === "deleted") {
    throw new SessionNotFoundError(sessionId);
  }
}
