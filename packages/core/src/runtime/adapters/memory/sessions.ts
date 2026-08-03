import type {
  AcceptRuntimeSessionInputsInput,
  CreateRuntimeSessionInput,
  CreateRuntimeSessionResult,
  RuntimeSessionInputRecord,
  RuntimeSessionRecord,
  RuntimeSessionStorePort,
} from "../../ports/sessions";
import type { MemoryRuntimeData, MemoryWriteRecorder } from "./data";
import { scopedKey } from "./data";

export function createMemorySessionStore(
  data: MemoryRuntimeData,
  recordWrite?: MemoryWriteRecorder,
): RuntimeSessionStorePort {
  return {
    async create(
      input: CreateRuntimeSessionInput,
    ): Promise<CreateRuntimeSessionResult> {
      const key = scopedKey(input.namespace, input.keyHash);
      const existing = data.sessionsByKey.get(key);
      if (existing) {
        return existing.targetId === input.targetId
          ? { kind: "existing", session: existing }
          : { kind: "conflict", session: existing };
      }
      const now = input.now.toISOString();
      const session: RuntimeSessionRecord = Object.freeze({
        schemaVersion: 1,
        namespace: input.namespace,
        sessionId: input.sessionId,
        keyHash: input.keyHash,
        targetId: input.targetId,
        threadId: input.threadId,
        state: "prepared",
        acceptedCursor: 0,
        wakePending: false,
        createdAt: now,
        updatedAt: now,
      });
      data.sessionsByKey.set(key, session);
      data.sessionsById.set(
        scopedKey(input.namespace, input.sessionId),
        session,
      );
      recordWrite?.();
      return { kind: "created", session };
    },
    async getByKey(namespace, keyHash) {
      return data.sessionsByKey.get(scopedKey(namespace, keyHash)) ?? null;
    },
    async markReady(namespace, sessionId, now) {
      const sessionKey = scopedKey(namespace, sessionId);
      const session = data.sessionsById.get(sessionKey);
      if (!session) throw new Error(`Session "${sessionId}" was not found.`);
      if (session.state === "ready") return session;
      const updated = Object.freeze({
        ...session,
        state: "ready" as const,
        updatedAt: now.toISOString(),
      });
      data.sessionsById.set(sessionKey, updated);
      data.sessionsByKey.set(scopedKey(namespace, session.keyHash), updated);
      recordWrite?.();
      return updated;
    },
    async acceptInputs(input: AcceptRuntimeSessionInputsInput) {
      const sessionKey = scopedKey(input.namespace, input.sessionId);
      const session = data.sessionsById.get(sessionKey);
      if (!session)
        throw new Error(`Session "${input.sessionId}" was not found.`);
      if (session.state !== "ready") {
        throw new Error(`Session "${input.sessionId}" is not ready.`);
      }
      const acceptedAt = input.now.toISOString();
      const inputs = input.inputs.map((value, index) =>
        Object.freeze({
          schemaVersion: 1 as const,
          namespace: input.namespace,
          sessionId: input.sessionId,
          inputId: `input_${input.sessionId}_${session.acceptedCursor + index + 1}`,
          cursor: session.acceptedCursor + index + 1,
          input: value,
          acceptedAt,
        }),
      );
      const updated = Object.freeze({
        ...session,
        acceptedCursor: session.acceptedCursor + inputs.length,
        wakePending: true,
        updatedAt: acceptedAt,
      });
      data.sessionsById.set(sessionKey, updated);
      data.sessionsByKey.set(
        scopedKey(input.namespace, session.keyHash),
        updated,
      );
      for (const accepted of inputs) {
        data.sessionInputs.set(
          scopedKey(input.namespace, accepted.inputId),
          accepted,
        );
      }
      recordWrite?.();
      return inputs as readonly RuntimeSessionInputRecord[];
    },
  };
}
