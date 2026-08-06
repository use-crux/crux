/** Shared Session lifecycle guards, lineage, and fork identity helpers. */

import { sha256Hex } from "../content/sha256";
import type { ResolvedRuntimeEngine } from "../runtime/api/create-runtime";
import type { RuntimeSessionRecord } from "../runtime/ports/sessions";
import type { RuntimeSessionStorePort } from "../runtime/ports/sessions";
import {
  SessionCapabilityError,
  SessionClosedError,
  SessionDeletedError,
  SessionLifecycleError,
  SessionNotFoundError,
} from "./errors";
import type { SessionForkLineage } from "./types";

const encoder = new TextEncoder();

/** Require the Runtime Session port with lifecycle operations. */
export function requireLifecycleSessions(
  runtime: ResolvedRuntimeEngine,
): NonNullable<RuntimeSessionStorePort> {
  const sessions = runtime.store.sessions;
  if (
    !sessions?.close ||
    !sessions.kill ||
    !sessions.delete ||
    !sessions.fork ||
    !sessions.listForks
  ) {
    throw new SessionCapabilityError();
  }
  return sessions;
}

/** Load one Session by id or throw SessionNotFoundError. */
export async function requireSessionRecord(
  runtime: ResolvedRuntimeEngine,
  sessionId: string,
): Promise<RuntimeSessionRecord> {
  const record = await runtime.store.sessions?.get(
    runtime.namespace,
    sessionId,
  );
  if (!record) throw new SessionNotFoundError(sessionId);
  return record;
}

export function assertSessionNotDeleted(record: RuntimeSessionRecord): void {
  if (record.state === "deleted") {
    throw new SessionDeletedError(record.sessionId);
  }
}

export function isTerminalClosedSession(
  record: RuntimeSessionRecord,
): boolean {
  return record.state === "closed" || record.state === "killed";
}

/** Shared guard used by send/subscribe against sealed Sessions. */
export function assertSessionAcceptsIngress(
  record: RuntimeSessionRecord,
): void {
  if (record.state === "deleted") {
    throw new SessionDeletedError(record.sessionId);
  }
  if (
    record.state === "closing" ||
    record.state === "closed" ||
    record.state === "killed"
  ) {
    throw new SessionClosedError(record.sessionId);
  }
  if (record.state !== "ready") {
    throw new SessionLifecycleError(
      `Session "${record.sessionId}" is not ready for ingress.`,
    );
  }
}

/** Pure parent preconditions for fork/clone. */
export function assertParentMayFork(parent: RuntimeSessionRecord): void {
  assertSessionNotDeleted(parent);
  if (parent.state === "closing") {
    throw new SessionLifecycleError(
      `Session "${parent.sessionId}" cannot fork while closing.`,
    );
  }
  if (parent.state === "prepared") {
    throw new SessionLifecycleError(
      `Session "${parent.sessionId}" cannot fork before it is ready.`,
    );
  }
  if (parent.blockedWork > 0 && parent.state === "ready") {
    throw new SessionLifecycleError(
      `Session "${parent.sessionId}" cannot fork while blocked.`,
    );
  }
}

/** Project immutable public lineage from a durable record. */
export function lineageFromRecord(
  record: RuntimeSessionRecord,
): SessionForkLineage | undefined {
  if (!record.forkedFrom) return undefined;
  return Object.freeze({
    sessionId: record.forkedFrom.sessionId,
    cursor: String(record.forkedFrom.cursor),
    threadRevision: record.forkedFrom.threadRevision,
  });
}

/**
 * Deterministic child Session id from the pinned parent boundary.
 *
 * @remarks Uses parent head (not control revision) so owner registration
 * cannot change identity on crash/retry.
 */
export function forkSessionId(
  namespace: string,
  parentSessionId: string,
  cursor: number,
  pinnedHead: string,
): string {
  const digest = sha256Hex(
    encoder.encode(
      JSON.stringify([
        "crux-session-fork:v1",
        namespace,
        parentSessionId,
        cursor,
        pinnedHead,
      ]),
    ),
  );
  return `session_fork_${digest}`;
}

export function forkKeyHash(namespace: string, childSessionId: string): string {
  return sha256Hex(
    encoder.encode(
      JSON.stringify(["crux-session-fork-key:v1", namespace, childSessionId]),
    ),
  );
}
