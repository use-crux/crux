/** Project public SessionStatus from a durable Session record. */

import type { RuntimeSessionRecord } from "../runtime/ports/sessions";
import type { SessionStatus } from "./types";

/** Map one durable Session control record to the public compact status. */
export function sessionStatusFromRecord(
  record: RuntimeSessionRecord,
): SessionStatus {
  const state =
    record.state === "closing"
      ? "closing"
      : record.state === "closed" || record.state === "killed"
        ? "closed"
        : record.state === "deleted"
          ? "closed"
          : record.blockedWork > 0
            ? "blocked"
            : record.pendingInputs > 0 || record.pendingWork > 0
              ? "running"
              : "parked";
  return Object.freeze({
    state,
    ...(record.acceptedCursor > 0
      ? { acceptedCursor: String(record.acceptedCursor) }
      : {}),
    ...(record.processedCursor === undefined
      ? {}
      : { processedCursor: String(record.processedCursor) }),
    pendingInputs: record.pendingInputs,
    pendingWork: record.pendingWork,
  });
}

/**
 * Stable idempotent event id for one public status projection.
 *
 * @remarks Lifecycle terminal states use a short id so retries of close/kill/
 * delete do not append a second logical status event.
 */
export function sessionStatusEventId(
  sessionId: string,
  status: SessionStatus,
  storageState: RuntimeSessionRecord["state"],
): string {
  if (
    storageState === "closed" ||
    storageState === "killed" ||
    storageState === "deleted" ||
    storageState === "closing" ||
    storageState === "ready"
  ) {
    return `session.status:${sessionId}:${storageState}`;
  }
  return `session.status:${sessionId}:${status.state}:${status.acceptedCursor ?? "0"}:${status.processedCursor ?? "0"}`;
}
