/** Public Session close/kill/delete/fork orchestration on canonical ports. */

import type { ResolvedRuntimeEngine } from "../runtime/api/create-runtime";
import { appendSessionStatusEvent } from "../runtime/engine/session-events";
import type { RuntimeSessionRecord } from "../runtime/ports/sessions";
import type { RuntimeStoreTransaction } from "../runtime/store";
import type { Storage } from "../storage";
import {
  registerThreadOwner,
  setThreadOwnerState,
  unregisterThreadOwner,
} from "../thread/owner";
import { readThreadRevision } from "../thread/store/revision";
import { waitForDurableWorkChange } from "../work/internal/durable-wait";
import {
  SessionLifecycleError,
  SessionNotClosedError,
  SessionTombstonedError,
} from "./errors";
import {
  assertParentMayFork,
  assertSessionNotDeleted,
  forkKeyHash,
  forkSessionId,
  isTerminalClosedSession,
  lineageFromRecord,
  requireLifecycleSessions,
  requireSessionRecord,
} from "./lifecycle-helpers";
import {
  sessionStatusEventId,
  sessionStatusFromRecord,
} from "./status-project";
import type { SessionForkSummary } from "./types";

export {
  assertSessionAcceptsIngress,
  lineageFromRecord,
} from "./lifecycle-helpers";

async function emitLifecycleStatus(
  tx: RuntimeStoreTransaction,
  record: RuntimeSessionRecord,
): Promise<void> {
  const status = sessionStatusFromRecord(record);
  await appendSessionStatusEvent(tx, {
    namespace: record.namespace,
    sessionId: record.sessionId,
    status,
    eventId: sessionStatusEventId(record.sessionId, status, record.state),
  });
}

/**
 * Ordered durable close barrier that joins until the Session is closed.
 *
 * @remarks At the barrier, external send/subscribe is sealed and all durable
 * Session Signal subscriptions are deactivated. The Session remains `closing`
 * until currently represented activation/input obligations
 * (`pendingInputs` / `pendingWork` / activation) drain, then becomes `closed`.
 * Nested causal Work trees beyond those counters are not yet counted. Does not
 * wake a parked Session merely for maintenance. Store writes use
 * `runtime.store.transact`.
 */
export async function closeSession(
  runtime: ResolvedRuntimeEngine,
  record: RuntimeSessionRecord,
  storage: Storage,
): Promise<void> {
  requireLifecycleSessions(runtime);
  let current = await requireSessionRecord(runtime, record.sessionId);
  assertSessionNotDeleted(current);
  if (isTerminalClosedSession(current)) {
    await setThreadOwnerState(storage, current.threadId, current.sessionId, "closed");
    return;
  }
  current = await runtime.store.transact(async (tx) => {
    const sessions = tx.sessions;
    if (!sessions?.close) throw new Error("Session close is unavailable.");
    const next = await sessions.close({
      namespace: runtime.namespace,
      sessionId: current.sessionId,
      now: runtime.now(),
    });
    await emitLifecycleStatus(tx, next);
    return next;
  });
  if (isTerminalClosedSession(current)) {
    await setThreadOwnerState(storage, current.threadId, current.sessionId, "closed");
    return;
  }
  let waitAttempt = 0;
  for (;;) {
    current = await requireSessionRecord(runtime, record.sessionId);
    if (isTerminalClosedSession(current)) {
      await setThreadOwnerState(
        storage,
        current.threadId,
        current.sessionId,
        "closed",
      );
      return;
    }
    if (current.state !== "closing") {
      throw new SessionLifecycleError(
        `Session "${current.sessionId}" left the close barrier in state "${current.state}".`,
      );
    }
    waitAttempt = await waitForDurableWorkChange(waitAttempt);
  }
}

/**
 * Fenced kill that cancels active Work and seals the Session.
 *
 * @remarks Store fence uses `runtime.store.transact`. Retries after a partial
 * failure still cancel `fencedWorkId` without restoring commit authority.
 */
export async function killSession(
  runtime: ResolvedRuntimeEngine,
  record: RuntimeSessionRecord,
  storage: Storage,
): Promise<void> {
  requireLifecycleSessions(runtime);
  let current = await requireSessionRecord(runtime, record.sessionId);
  assertSessionNotDeleted(current);
  current = await runtime.store.transact(async (tx) => {
    const sessions = tx.sessions;
    if (!sessions?.kill) throw new Error("Session kill is unavailable.");
    const next = await sessions.kill({
      namespace: runtime.namespace,
      sessionId: current.sessionId,
      now: runtime.now(),
    });
    await emitLifecycleStatus(tx, next);
    return next;
  });
  const workId = current.fencedWorkId;
  if (workId) {
    await runtime.kernel.cancelWork({
      namespace: runtime.namespace,
      workId,
      reason: "session.kill",
    });
  }
  await setThreadOwnerState(storage, current.threadId, current.sessionId, "closed");
}

/**
 * Retention-safe delete after close/kill.
 *
 * @remarks Unregisters the Thread owner only after the Session tombstone is
 * durable so concurrent Thread deletion cannot race past an open owner.
 */
export async function deleteSession(
  runtime: ResolvedRuntimeEngine,
  record: RuntimeSessionRecord,
  storage: Storage,
): Promise<void> {
  requireLifecycleSessions(runtime);
  const current = await requireSessionRecord(runtime, record.sessionId);
  if (current.state === "deleted") {
    await unregisterThreadOwner(storage, current.threadId, current.sessionId);
    return;
  }
  if (current.state !== "closed" && current.state !== "killed") {
    throw new SessionNotClosedError(current.sessionId);
  }
  const deleted = await runtime.store.transact(async (tx) => {
    const sessions = tx.sessions;
    if (!sessions?.delete) throw new Error("Session delete is unavailable.");
    const next = await sessions.delete({
      namespace: runtime.namespace,
      sessionId: current.sessionId,
      now: runtime.now(),
    });
    await emitLifecycleStatus(tx, next);
    return next;
  });
  await unregisterThreadOwner(storage, deleted.threadId, deleted.sessionId);
}

/**
 * Create a child Session with an independent owner head at the parent revision.
 *
 * @remarks Ordering is fail-safe: register the child owner/head pin through the
 * Thread registry first, then persist the idempotent Session fork record via
 * `runtime.store.transact`. Deleted children at the same identity reject.
 */
export async function forkSessionRecord(
  runtime: ResolvedRuntimeEngine,
  record: RuntimeSessionRecord,
  storage: Storage,
): Promise<RuntimeSessionRecord> {
  requireLifecycleSessions(runtime);
  const parent = await requireSessionRecord(runtime, record.sessionId);
  assertParentMayFork(parent);
  const threadRevision = await readThreadRevision(storage, parent.threadId);
  const head = (await storage.records.get(`thread/${parent.threadId}`)) as
    | { readonly heads?: Readonly<Record<string, string>> }
    | null;
  const pinnedHead = head?.heads?.[parent.sessionId];
  const childSessionId = forkSessionId(
    runtime.namespace,
    parent.sessionId,
    parent.acceptedCursor,
    pinnedHead ?? "",
  );
  const childKeyHash = forkKeyHash(runtime.namespace, childSessionId);
  await registerThreadOwner(
    storage,
    parent.threadId,
    { id: childSessionId, state: "open" },
    pinnedHead === undefined ? {} : { head: pinnedHead },
  );
  try {
    const forked = await runtime.store.transact(async (tx) => {
      const sessions = tx.sessions;
      if (!sessions?.fork) throw new Error("Session fork is unavailable.");
      return sessions.fork({
        namespace: runtime.namespace,
        sessionId: parent.sessionId,
        childSessionId,
        childKeyHash,
        threadRevision,
        now: runtime.now(),
      });
    });
    return forked.child;
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes("SESSION_TOMBSTONED") ||
        error.message.includes("tombstoned"))
    ) {
      throw new SessionTombstonedError(childSessionId);
    }
    throw error;
  }
}

/** List direct fork children for one parent Session. */
export async function listSessionForks(
  runtime: ResolvedRuntimeEngine,
  record: RuntimeSessionRecord,
): Promise<readonly SessionForkSummary[]> {
  const sessions = requireLifecycleSessions(runtime);
  const children = await sessions.listForks!(
    runtime.namespace,
    record.sessionId,
  );
  return Object.freeze(
    children.map((child) =>
      Object.freeze({
        sessionId: child.sessionId,
        forkedFrom: lineageFromRecord(child)!,
      }),
    ),
  );
}
