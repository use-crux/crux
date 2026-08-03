/** Canonical in-memory Session turn linkage and bounded accounting. */

import type {
  LinkRuntimeSessionTurnInput,
  RuntimeSessionInputRecord,
  RuntimeSessionRecord,
  RuntimeSessionTurnInput,
} from "../../ports/sessions";
import { recordSessionStatistics } from "../../engine/session-statistics";
import type { MemoryRuntimeData, MemoryWriteRecorder } from "./data";
import { scopedKey } from "./data";

export function linkSessionTurn(
  data: MemoryRuntimeData,
  input: LinkRuntimeSessionTurnInput,
  recordWrite?: MemoryWriteRecorder,
): RuntimeSessionInputRecord {
  const accepted = sessionInput(data, input);
  if (accepted.work) {
    if (
      accepted.work.workId !== input.workId ||
      accepted.work.target !== input.target
    ) {
      throw new Error(
        `Session input "${input.inputId}" has conflicting Work linkage.`,
      );
    }
    return accepted;
  }
  const linked = Object.freeze({
    ...accepted,
    work: Object.freeze({
      workId: input.workId,
      target: input.target,
      state: "queued" as const,
    }),
  });
  data.sessionInputs.set(scopedKey(input.namespace, input.inputId), linked);
  updateSession(data, input, (session) => ({
    ...session,
    pendingInputs: session.pendingInputs + 1,
    pendingWork: session.pendingWork + 1,
    statistics: recordSessionStatistics(
      session.statistics,
      session.sessionId,
      input.now,
      [{ kind: "work-accepted", target: input.target, state: "queued" }],
    ),
    updatedAt: input.now.toISOString(),
  }));
  recordWrite?.();
  return linked;
}

export function startSessionTurn(
  data: MemoryRuntimeData,
  input: RuntimeSessionTurnInput,
  recordWrite?: MemoryWriteRecorder,
): RuntimeSessionInputRecord {
  const accepted = sessionInput(data, input);
  const work = accepted.work;
  if (!work || work.state !== "queued") return accepted;
  const started = Object.freeze({
    ...accepted,
    work: Object.freeze({ ...work, state: "running" as const }),
  });
  data.sessionInputs.set(scopedKey(input.namespace, input.inputId), started);
  updateSession(data, input, (session) => ({
    ...session,
    statistics: recordSessionStatistics(
      session.statistics,
      session.sessionId,
      input.now,
      [
        {
          kind: "work-state",
          target: work.target,
          from: "queued",
          to: "running",
        },
      ],
    ),
    updatedAt: input.now.toISOString(),
  }));
  recordWrite?.();
  return started;
}

export function settleSessionTurn(
  data: MemoryRuntimeData,
  input: RuntimeSessionTurnInput,
  outcome: "completed" | "blocked",
  recordWrite?: MemoryWriteRecorder,
): RuntimeSessionRecord {
  const accepted = sessionInput(data, input);
  const work = accepted.work;
  if (!work) throw new Error(`Session input "${input.inputId}" has no Work.`);
  if (work.state === "completed" || work.state === "blocked") {
    return currentSession(data, input);
  }
  const from = work.state;
  data.sessionInputs.set(
    scopedKey(input.namespace, input.inputId),
    Object.freeze({
      ...accepted,
      work: Object.freeze({ ...work, state: outcome }),
    }),
  );
  const updated = updateSession(data, input, (session) => ({
    ...session,
    ...(outcome === "completed" ? { processedCursor: accepted.cursor } : {}),
    pendingInputs: session.pendingInputs - 1,
    pendingWork:
      outcome === "completed" ? session.pendingWork - 1 : session.pendingWork,
    blockedWork:
      outcome === "blocked" ? session.blockedWork + 1 : session.blockedWork,
    statistics: recordSessionStatistics(
      session.statistics,
      session.sessionId,
      input.now,
      outcome === "completed"
        ? [{ kind: "work-outcome", target: work.target, from, outcome }]
        : [{ kind: "work-state", target: work.target, from, to: "blocked" }],
    ),
    wakePending: false,
    updatedAt: input.now.toISOString(),
  }));
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

function updateSession(
  data: MemoryRuntimeData,
  input: RuntimeSessionTurnInput,
  update: (session: RuntimeSessionRecord) => RuntimeSessionRecord,
): RuntimeSessionRecord {
  const current = currentSession(data, input);
  const next = Object.freeze(update(current));
  data.sessionsById.set(scopedKey(input.namespace, input.sessionId), next);
  data.sessionsByKey.set(scopedKey(input.namespace, current.keyHash), next);
  return next;
}
