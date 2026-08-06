import type {
  AcceptRuntimeSessionInputsInput,
  CheckpointRuntimeSessionExecutionInput,
  CreateRuntimeSessionInput,
  CreateRuntimeSessionResult,
  RuntimeSessionInputRecord,
  RuntimeSessionRecord,
  RuntimeSessionStorePort,
  RuntimeSessionPreparedExecution,
} from "../../ports/sessions";
import { cloneRuntimeResultRef } from "../../results/types";
import { initialSessionStatistics } from "../../engine/session-statistics";
import {
  claimSessionStepInputs,
  getSessionTurnInputs,
  reserveSessionTurn,
  startSessionTurn,
} from "./session-lifecycle";
import { settleSessionTurn } from "./session-settlement";
import {
  assertSameSessionCheckpoint,
  sessionCheckpointCrash,
  sessionIngressDeliveryCrash,
} from "./session-faults";
import {
  getMemorySessionSubscription,
  listMemoryActiveSubscriptionsForSignal,
  listMemorySessionSubscriptions,
  unsubscribeMemorySessionSubscription,
  upsertMemorySessionSubscription,
} from "./session-subscriptions";
import {
  closeMemorySession,
  deleteMemorySession,
  forkMemorySession,
  killMemorySession,
  listMemorySessionForks,
  sessionAcceptsIngress,
  sessionAcceptsWorkMutation,
} from "./session-controls";
import type { MemoryRuntimeData, MemoryWriteRecorder } from "./data";
import { scopedKey } from "./data";

/** One-shot process-loss fault at the prepared execution boundary. */
export interface MemorySessionFaults {
  /** Stop after ingress delivery writes and before boundary preparation. */
  crashAfterIngressDelivery: boolean;
  /** Stop after the checkpoint write and before owner-Thread publication. */
  crashAfterPreparedExecution: boolean;
  /** Delete a prepared result artifact immediately after its checkpoint write. */
  missingPreparedResultArtifact: boolean;
}

export function createMemorySessionStore(
  data: MemoryRuntimeData,
  recordWrite?: MemoryWriteRecorder,
  faults?: MemorySessionFaults,
): RuntimeSessionStorePort {
  return {
    async create(
      input: CreateRuntimeSessionInput,
    ): Promise<CreateRuntimeSessionResult> {
      const key = scopedKey(input.namespace, input.keyHash);
      const existing = data.sessionsByKey.get(key);
      if (existing) {
        if (existing.state === "deleted") {
          return { kind: "tombstone", session: existing };
        }
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
        targetKind: input.targetKind,
        threadId: input.threadId,
        ...(input.model
          ? { model: Object.freeze({ ...input.model }) }
          : {}),
        ...(input.definition
          ? { definition: Object.freeze({ ...input.definition }) }
          : {}),
        state: "prepared",
        acceptedCursor: 0,
        pendingInputs: 0,
        pendingWork: 0,
        blockedWork: 0,
        statistics: initialSessionStatistics(input.sessionId, input.now),
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
    async get(namespace, sessionId) {
      return data.sessionsById.get(scopedKey(namespace, sessionId)) ?? null;
    },
    async getByActivationWorkId(namespace, workId) {
      return (
        [...data.sessionsById.values()].find(
          (session) =>
            session.namespace === namespace &&
            session.activation?.workId === workId,
        ) ?? null
      );
    },
    async getInput(namespace, sessionId, inputId) {
      const accepted = data.sessionInputs.get(scopedKey(namespace, inputId));
      return accepted?.sessionId === sessionId ? accepted : null;
    },
    async getInputAtCursor(namespace, sessionId, cursor) {
      return (
        [...data.sessionInputs.values()].find(
          (accepted) =>
            accepted.namespace === namespace &&
            accepted.sessionId === sessionId &&
            accepted.cursor === cursor,
        ) ?? null
      );
    },
    async inspectInputs(namespace, sessionId, limit) {
      const all = [...data.sessionInputs.values()]
        .filter(
          (accepted) =>
            accepted.namespace === namespace &&
            accepted.sessionId === sessionId,
        )
        .sort((left, right) => left.cursor - right.cursor);
      return Object.freeze({
        inputs: Object.freeze(all.slice(-limit)),
        truncated: all.length > limit,
      });
    },
    async markReady(namespace, sessionId, now) {
      const sessionKey = scopedKey(namespace, sessionId);
      const session = data.sessionsById.get(sessionKey);
      if (!session) throw new Error(`Session "${sessionId}" was not found.`);
      if (session.state === "ready") return session;
      if (session.state !== "prepared") {
        throw new Error(
          `Session "${sessionId}" cannot become ready from state "${session.state}".`,
        );
      }
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
      if (!sessionAcceptsIngress(session)) {
        throw new Error(
          `Session "${input.sessionId}" no longer accepts external ingress.`,
        );
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
        pendingInputs: session.pendingInputs + inputs.length,
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
    async reserveTurn(input) {
      return reserveSessionTurn(data, input, recordWrite);
    },
    async startTurn(input) {
      return startSessionTurn(data, input, recordWrite);
    },
    async getTurnInputs(namespace, sessionId, workId) {
      return getSessionTurnInputs(data, namespace, sessionId, workId);
    },
    async claimStepInputs(input) {
      const claimed = claimSessionStepInputs(data, input, recordWrite);
      if (faults?.crashAfterIngressDelivery && claimed.inputs.length > 0) {
        faults.crashAfterIngressDelivery = false;
        throw sessionIngressDeliveryCrash(input.workId);
      }
      return claimed;
    },
    async getPreparedExecution(namespace, sessionId, inputId) {
      const accepted = data.sessionInputs.get(scopedKey(namespace, inputId));
      return accepted?.sessionId === sessionId
        ? (accepted.preparedExecution ?? null)
        : null;
    },
    async checkpointPreparedExecution(
      input: CheckpointRuntimeSessionExecutionInput,
    ) {
      const session = data.sessionsById.get(
        scopedKey(input.namespace, input.sessionId),
      );
      if (!session) {
        throw new Error(`Session "${input.sessionId}" was not found.`);
      }
      if (!sessionAcceptsWorkMutation(session)) {
        throw new Error(
          `Session "${input.sessionId}" no longer holds commit authority.`,
        );
      }
      const accepted = data.sessionInputs.get(
        scopedKey(input.namespace, input.inputId),
      );
      if (!accepted || accepted.sessionId !== input.sessionId) {
        throw new Error(`Session input "${input.inputId}" was not found.`);
      }
      const preparedExecution: RuntimeSessionPreparedExecution = Object.freeze({
        workId: input.workId,
        preparedResultRef: cloneRuntimeResultRef(input.preparedResultRef),
        checkpointedAt: input.now.toISOString(),
      });
      const joined = getSessionTurnInputs(
        data,
        input.namespace,
        input.sessionId,
        input.workId,
      );
      for (const member of joined) {
        if (member.preparedExecution) {
          assertSameSessionCheckpoint(member.preparedExecution, input);
          continue;
        }
        data.sessionInputs.set(
          scopedKey(input.namespace, member.inputId),
          Object.freeze({ ...member, preparedExecution }),
        );
      }
      if (joined.some((member) => !member.preparedExecution)) recordWrite?.();
      if (faults?.missingPreparedResultArtifact) {
        data.results.delete(preparedExecution.preparedResultRef.location);
      }
      if (faults?.crashAfterPreparedExecution) {
        faults.crashAfterPreparedExecution = false;
        throw sessionCheckpointCrash(input.workId);
      }
      return preparedExecution;
    },
    async completeTurn(input) {
      return settleSessionTurn(data, input, "completed", recordWrite);
    },
    async blockTurn(input) {
      return settleSessionTurn(data, input, "blocked", recordWrite);
    },
    async upsertSubscription(input) {
      return upsertMemorySessionSubscription(data, input, recordWrite);
    },
    async getSubscription(namespace, sessionId, subscriptionId) {
      return getMemorySessionSubscription(
        data,
        namespace,
        sessionId,
        subscriptionId,
      );
    },
    async listSubscriptions(namespace, sessionId) {
      return listMemorySessionSubscriptions(data, namespace, sessionId);
    },
    async listActiveSubscriptionsForSignal(namespace, signalId) {
      return listMemoryActiveSubscriptionsForSignal(data, namespace, signalId);
    },
    async unsubscribe(namespace, sessionId, subscriptionId, now) {
      return unsubscribeMemorySessionSubscription(
        data,
        namespace,
        sessionId,
        subscriptionId,
        now,
        recordWrite,
      );
    },
    async close(input) {
      return closeMemorySession(data, input, recordWrite);
    },
    async kill(input) {
      return killMemorySession(data, input, recordWrite);
    },
    async delete(input) {
      return deleteMemorySession(data, input, recordWrite);
    },
    async fork(input) {
      return forkMemorySession(data, input, recordWrite);
    },
    async listForks(namespace, sessionId) {
      return listMemorySessionForks(data, namespace, sessionId);
    },
  };
}
