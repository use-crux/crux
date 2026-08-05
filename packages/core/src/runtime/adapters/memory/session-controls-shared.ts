/** Shared in-memory Session record accessors for lifecycle controls. */

import type { RuntimeSessionRecord } from "../../ports/sessions";
import type { MemoryRuntimeData, MemoryWriteRecorder } from "./data";
import { scopedKey } from "./data";

export function currentSession(
  data: MemoryRuntimeData,
  namespace: string,
  sessionId: string,
): RuntimeSessionRecord {
  const session = data.sessionsById.get(scopedKey(namespace, sessionId));
  if (!session) throw new Error(`Session "${sessionId}" was not found.`);
  return session;
}

export function putSession(
  data: MemoryRuntimeData,
  session: RuntimeSessionRecord,
  recordWrite?: MemoryWriteRecorder,
): RuntimeSessionRecord {
  data.sessionsById.set(
    scopedKey(session.namespace, session.sessionId),
    session,
  );
  data.sessionsByKey.set(scopedKey(session.namespace, session.keyHash), session);
  recordWrite?.();
  return session;
}
