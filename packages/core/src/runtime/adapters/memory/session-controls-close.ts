/** In-memory Session close/kill transitions and subscription deactivation. */

import type {
  CloseRuntimeSessionInput,
  KillRuntimeSessionInput,
  RuntimeSessionRecord,
} from "../../ports/sessions";
import type { MemoryRuntimeData, MemoryWriteRecorder } from "./data";
import { currentSession, putSession } from "./session-controls-shared";

/**
 * Seal ingress, deactivate Signal subscriptions, and enter closing or closed.
 *
 * @remarks Re-reads the Session after deactivation so concurrent settlement
 * counters are not overwritten. Only lifecycle fields change.
 */
export function closeMemorySession(
  data: MemoryRuntimeData,
  input: CloseRuntimeSessionInput,
  recordWrite?: MemoryWriteRecorder,
): RuntimeSessionRecord {
  let session = currentSession(data, input.namespace, input.sessionId);
  if (session.state === "deleted") {
    throw new Error(`Session "${input.sessionId}" has been deleted.`);
  }
  deactivateSessionSubscriptions(
    data,
    input.namespace,
    input.sessionId,
    input.now,
    recordWrite,
  );
  // Re-read after side effects so pending counters reflect concurrent settlement.
  session = currentSession(data, input.namespace, input.sessionId);
  if (
    session.state === "closed" ||
    session.state === "killed" ||
    session.state === "closing"
  ) {
    return session;
  }
  if (session.state !== "ready") {
    throw new Error(
      `Session "${input.sessionId}" cannot close from state "${session.state}".`,
    );
  }
  const drained =
    session.pendingInputs === 0 &&
    session.pendingWork === 0 &&
    session.activation === undefined;
  return putSession(
    data,
    Object.freeze({
      ...session,
      state: drained ? ("closed" as const) : ("closing" as const),
      wakePending: drained ? false : session.wakePending,
      updatedAt: input.now.toISOString(),
    }),
    recordWrite,
  );
}

/**
 * Fence immediately: deactivate subscriptions, clear activation, retain fenced Work.
 *
 * @remarks `fencedWorkId` survives the fence so kill() retries can still cancel
 * residual Work after a partial failure.
 */
export function killMemorySession(
  data: MemoryRuntimeData,
  input: KillRuntimeSessionInput,
  recordWrite?: MemoryWriteRecorder,
): RuntimeSessionRecord {
  let session = currentSession(data, input.namespace, input.sessionId);
  if (session.state === "deleted") {
    throw new Error(`Session "${input.sessionId}" has been deleted.`);
  }
  deactivateSessionSubscriptions(
    data,
    input.namespace,
    input.sessionId,
    input.now,
    recordWrite,
  );
  session = currentSession(data, input.namespace, input.sessionId);
  if (session.state === "killed") return session;
  const fencedWorkId = session.fencedWorkId ?? session.activation?.workId;
  return putSession(
    data,
    Object.freeze({
      ...session,
      state: "killed" as const,
      pendingInputs: 0,
      pendingWork: 0,
      blockedWork: 0,
      activation: undefined,
      wakePending: false,
      ...(fencedWorkId ? { fencedWorkId } : {}),
      updatedAt: input.now.toISOString(),
    }),
    recordWrite,
  );
}

/** Finalize closing → closed once obligations drain. */
export function maybeFinalizeClosingSession(
  session: RuntimeSessionRecord,
  now: Date,
): RuntimeSessionRecord {
  if (session.state !== "closing") return session;
  if (
    session.pendingInputs > 0 ||
    session.pendingWork > 0 ||
    session.activation !== undefined
  ) {
    return session;
  }
  return Object.freeze({
    ...session,
    state: "closed" as const,
    wakePending: false,
    updatedAt: now.toISOString(),
  });
}

/** Mark every active Signal subscription for one Session unsubscribed. */
export function deactivateSessionSubscriptions(
  data: MemoryRuntimeData,
  namespace: string,
  sessionId: string,
  now: Date,
  recordWrite?: MemoryWriteRecorder,
): void {
  const updatedAt = now.toISOString();
  let changed = false;
  for (const [key, subscription] of data.sessionSubscriptions.entries()) {
    if (
      subscription.namespace !== namespace ||
      subscription.sessionId !== sessionId ||
      subscription.state !== "active"
    ) {
      continue;
    }
    data.sessionSubscriptions.set(
      key,
      Object.freeze({
        ...subscription,
        state: "unsubscribed" as const,
        updatedAt,
      }),
    );
    changed = true;
  }
  if (changed) recordWrite?.();
}
