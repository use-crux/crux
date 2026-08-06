/** In-memory Session delete/fork transitions. */

import type {
  DeleteRuntimeSessionInput,
  ForkRuntimeSessionInput,
  ForkRuntimeSessionResult,
  RuntimeSessionRecord,
} from "../../ports/sessions";
import { initialSessionStatistics } from "../../engine/session-statistics";
import type { MemoryRuntimeData, MemoryWriteRecorder } from "./data";
import { scopedKey } from "./data";
import { currentSession, putSession } from "./session-controls-shared";

/** Tombstone a closed/killed Session and strip input payloads. */
export function deleteMemorySession(
  data: MemoryRuntimeData,
  input: DeleteRuntimeSessionInput,
  recordWrite?: MemoryWriteRecorder,
): RuntimeSessionRecord {
  const session = currentSession(data, input.namespace, input.sessionId);
  if (session.state === "deleted") return session;
  if (session.state !== "closed" && session.state !== "killed") {
    throw new Error(
      `Session "${input.sessionId}" must be closed or killed before delete.`,
    );
  }
  for (const [key, accepted] of [...data.sessionInputs.entries()]) {
    if (
      accepted.namespace === input.namespace &&
      accepted.sessionId === input.sessionId
    ) {
      data.sessionInputs.delete(key);
    }
  }
  for (const [key, subscription] of [...data.sessionSubscriptions.entries()]) {
    if (
      subscription.namespace === input.namespace &&
      subscription.sessionId === input.sessionId
    ) {
      data.sessionSubscriptions.delete(key);
    }
  }
  return putSession(
    data,
    Object.freeze({
      schemaVersion: 1 as const,
      namespace: session.namespace,
      sessionId: session.sessionId,
      keyHash: session.keyHash,
      targetId: session.targetId,
      targetKind: session.targetKind,
      threadId: session.threadId,
      state: "deleted" as const,
      acceptedCursor: session.acceptedCursor,
      ...(session.processedCursor === undefined
        ? {}
        : { processedCursor: session.processedCursor }),
      pendingInputs: 0,
      pendingWork: 0,
      blockedWork: 0,
      statistics: session.statistics,
      wakePending: false,
      ...(session.parentSessionId
        ? { parentSessionId: session.parentSessionId }
        : {}),
      ...(session.forkedFrom ? { forkedFrom: session.forkedFrom } : {}),
      createdAt: session.createdAt,
      updatedAt: input.now.toISOString(),
    }),
    recordWrite,
  );
}

/**
 * Create a parked child Session with immutable lineage.
 *
 * @remarks Existing deleted children at the same deterministic id reject with a
 * tombstone signal so parent.fork cannot resurrect them.
 */
export function forkMemorySession(
  data: MemoryRuntimeData,
  input: ForkRuntimeSessionInput,
  recordWrite?: MemoryWriteRecorder,
): ForkRuntimeSessionResult {
  const parent = currentSession(data, input.namespace, input.sessionId);
  if (
    parent.state === "deleted" ||
    parent.state === "closing" ||
    parent.state === "prepared"
  ) {
    throw new Error(
      `Session "${input.sessionId}" cannot fork from state "${parent.state}".`,
    );
  }
  const existing = data.sessionsById.get(
    scopedKey(input.namespace, input.childSessionId),
  );
  if (existing) {
    if (existing.state === "deleted") {
      throw new Error(
        `SESSION_TOMBSTONED: Session "${input.childSessionId}" is tombstoned and cannot be resurrected by fork.`,
      );
    }
    if (
      existing.parentSessionId !== parent.sessionId ||
      existing.targetId !== parent.targetId ||
      existing.threadId !== parent.threadId
    ) {
      throw new Error(
        `Session fork "${input.childSessionId}" conflicts with an existing identity.`,
      );
    }
    return Object.freeze({ parent, child: existing });
  }
  const now = input.now.toISOString();
  const child = Object.freeze({
    schemaVersion: 1 as const,
    namespace: parent.namespace,
    sessionId: input.childSessionId,
    keyHash: input.childKeyHash,
    targetId: parent.targetId,
    targetKind: parent.targetKind,
    threadId: parent.threadId,
    ...(parent.model ? { model: parent.model } : {}),
    ...(parent.definition ? { definition: parent.definition } : {}),
    state: "ready" as const,
    acceptedCursor: 0,
    pendingInputs: 0,
    pendingWork: 0,
    blockedWork: 0,
    statistics: initialSessionStatistics(input.childSessionId, input.now),
    wakePending: false,
    parentSessionId: parent.sessionId,
    forkedFrom: Object.freeze({
      sessionId: parent.sessionId,
      cursor: parent.acceptedCursor,
      threadRevision: input.threadRevision,
    }),
    createdAt: now,
    updatedAt: now,
  }) satisfies RuntimeSessionRecord;
  putSession(data, child, recordWrite);
  return Object.freeze({ parent, child });
}

/** List direct fork children. */
export function listMemorySessionForks(
  data: MemoryRuntimeData,
  namespace: string,
  sessionId: string,
): readonly RuntimeSessionRecord[] {
  return Object.freeze(
    [...data.sessionsById.values()]
      .filter(
        (session) =>
          session.namespace === namespace &&
          session.parentSessionId === sessionId &&
          session.state !== "deleted",
      )
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
  );
}
