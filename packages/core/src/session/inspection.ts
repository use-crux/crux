/** Public projections of one canonical durable Session summary. */

import type { ResolvedRuntimeEngine } from "../runtime/api/create-runtime";
import { sessionStatistics } from "../runtime/engine/session-statistics";
import type { ExecutionStats } from "../work";
import { SessionNotFoundError } from "./errors";
import type { SessionStatus } from "./types";

/** Read a detached compact status without scanning child Work rows. */
export async function readSessionStatus(
  runtime: ResolvedRuntimeEngine,
  sessionId: string,
): Promise<SessionStatus> {
  const record = await readSession(runtime, sessionId);
  return Object.freeze({
    state:
      record.blockedWork > 0
        ? "blocked"
        : record.pendingInputs > 0 || record.pendingWork > 0
          ? "running"
          : "parked",
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

/** Read the existing detached bounded statistics aggregate for this Session. */
export async function readSessionStats(
  runtime: ResolvedRuntimeEngine,
  sessionId: string,
): Promise<ExecutionStats> {
  const record = await readSession(runtime, sessionId);
  return sessionStatistics(record.statistics, record.sessionId);
}

async function readSession(runtime: ResolvedRuntimeEngine, sessionId: string) {
  const record = await runtime.store.sessions?.get(
    runtime.namespace,
    sessionId,
  );
  if (!record) throw new SessionNotFoundError(sessionId);
  return record;
}
