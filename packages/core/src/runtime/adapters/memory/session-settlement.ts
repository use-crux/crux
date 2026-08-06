/** Atomic shared outcome projection for one in-memory Session activation. */

import { recordSessionStatistics } from "../../engine/session-statistics";
import type {
  RuntimeSessionInputRecord,
  RuntimeSessionRecord,
  RuntimeSessionTurnInput,
} from "../../ports/sessions";
import type { MemoryRuntimeData, MemoryWriteRecorder } from "./data";
import { scopedKey } from "./data";
import {
  maybeFinalizeClosingSession,
  sessionAcceptsWorkMutation,
} from "./session-controls";
import { getSessionTurnInputs } from "./session-lifecycle";

export function settleSessionTurn(
  data: MemoryRuntimeData,
  input: RuntimeSessionTurnInput,
  outcome: "completed" | "blocked",
  recordWrite?: MemoryWriteRecorder,
): RuntimeSessionRecord {
  const session = currentSession(data, input);
  // Killed/deleted Sessions ignore late settlement so provider output cannot
  // rewrite the lifecycle or Thread-facing counters.
  if (!sessionAcceptsWorkMutation(session)) return session;
  const accepted = sessionInput(data, input);
  const work = accepted.work;
  if (!work) throw new Error(`Session input "${input.inputId}" has no Work.`);
  if (work.state === "completed" || work.state === "blocked") {
    return session;
  }
  const joined = getSessionTurnInputs(
    data,
    input.namespace,
    input.sessionId,
    work.workId,
  );
  for (const member of joined) {
    if (!member.work)
      throw new Error("Session activation linkage is incomplete.");
    data.sessionInputs.set(
      scopedKey(input.namespace, member.inputId),
      Object.freeze({
        ...member,
        work: Object.freeze({ ...member.work, state: outcome }),
      }),
    );
  }
  const processedCursor = Math.max(...joined.map((member) => member.cursor));
  const settled = Object.freeze({
    ...session,
    ...(outcome === "completed" ? { processedCursor } : {}),
    pendingInputs: session.pendingInputs - joined.length,
    pendingWork:
      outcome === "completed" ? session.pendingWork - 1 : session.pendingWork,
    blockedWork:
      outcome === "blocked" ? session.blockedWork + 1 : session.blockedWork,
    statistics: recordSessionStatistics(
      session.statistics,
      session.sessionId,
      input.now,
      outcome === "completed"
        ? [
            {
              kind: "work-outcome" as const,
              target: work.target,
              from: work.state,
              outcome,
            },
          ]
        : [
            {
              kind: "work-state" as const,
              target: work.target,
              from: work.state,
              to: outcome,
            },
          ],
    ),
    activation: outcome === "completed" ? undefined : session.activation,
    wakePending: session.acceptedCursor > processedCursor,
    updatedAt: input.now.toISOString(),
  });
  const updated = maybeFinalizeClosingSession(settled, input.now);
  data.sessionsById.set(scopedKey(input.namespace, input.sessionId), updated);
  data.sessionsByKey.set(scopedKey(input.namespace, session.keyHash), updated);
  recordWrite?.();
  return updated;
}

function sessionInput(
  data: MemoryRuntimeData,
  input: RuntimeSessionTurnInput,
): RuntimeSessionInputRecord {
  const accepted = data.sessionInputs.get(
    scopedKey(input.namespace, input.inputId),
  );
  if (!accepted || accepted.sessionId !== input.sessionId) {
    throw new Error(`Session input "${input.inputId}" was not found.`);
  }
  return accepted;
}

function currentSession(
  data: MemoryRuntimeData,
  input: RuntimeSessionTurnInput,
): RuntimeSessionRecord {
  const session = data.sessionsById.get(
    scopedKey(input.namespace, input.sessionId),
  );
  if (!session) throw new Error(`Session "${input.sessionId}" was not found.`);
  return session;
}
