/** Canonical in-memory Session activation claiming and bounded accounting. */

import type {
  ClaimRuntimeSessionStepInputsInput,
  ReserveRuntimeSessionTurnInput,
  RuntimeSessionActivation,
  RuntimeSessionActivationClaim,
  RuntimeSessionInputRecord,
  RuntimeSessionRecord,
  RuntimeSessionStepInputClaim,
  RuntimeSessionTurnInput,
} from "../../ports/sessions";
import { recordSessionStatistics } from "../../engine/session-statistics";
import type { MemoryRuntimeData, MemoryWriteRecorder } from "./data";
import { scopedKey } from "./data";
import { sessionAcceptsWorkMutation } from "./session-controls";

export function reserveSessionTurn(
  data: MemoryRuntimeData,
  input: ReserveRuntimeSessionTurnInput,
  recordWrite?: MemoryWriteRecorder,
): RuntimeSessionActivation {
  const current = currentSession(data, input);
  if (!sessionAcceptsWorkMutation(current)) {
    throw new Error(
      `Session "${input.sessionId}" no longer accepts Work mutations.`,
    );
  }
  if (current.activation) return current.activation;
  sessionInput(data, input);
  const activation = Object.freeze({
    workId: input.workId,
    primaryInputId: input.inputId,
    target: input.target,
    state: "queued" as const,
  });
  updateSession(data, input, (session) => ({
    ...session,
    activation,
    pendingWork: session.pendingWork + 1,
    statistics: recordSessionStatistics(
      session.statistics,
      session.sessionId,
      input.now,
      [{ kind: "work-accepted", target: input.target, state: "queued" }],
    ),
    wakePending: true,
    updatedAt: input.now.toISOString(),
  }));
  recordWrite?.();
  return activation;
}

export function startSessionTurn(
  data: MemoryRuntimeData,
  input: RuntimeSessionTurnInput,
  recordWrite?: MemoryWriteRecorder,
): RuntimeSessionActivationClaim | null {
  const session = currentSession(data, input);
  if (!sessionAcceptsWorkMutation(session)) return null;
  const activation = session.activation;
  if (!activation || activation.primaryInputId !== input.inputId) return null;
  if (activation.state === "running") {
    return Object.freeze({
      activation,
      inputs: turnInputs(data, input, activation.workId),
    });
  }
  const inputs = consecutiveInputs(data, session);
  if (inputs.length === 0 || inputs[0]?.inputId !== input.inputId) return null;
  const linked = inputs.map((accepted) =>
    Object.freeze({
      ...accepted,
      work: Object.freeze({
        workId: activation.workId,
        target: activation.target,
        state: "running" as const,
      }),
    }),
  );
  for (const accepted of linked) {
    data.sessionInputs.set(
      scopedKey(input.namespace, accepted.inputId),
      accepted,
    );
  }
  const running = Object.freeze({ ...activation, state: "running" as const });
  updateSession(data, input, (current) => ({
    ...current,
    activation: running,
    statistics: recordSessionStatistics(
      current.statistics,
      current.sessionId,
      input.now,
      [
        {
          kind: "work-state",
          target: activation.target,
          from: "queued",
          to: "running",
        },
      ],
    ),
    updatedAt: input.now.toISOString(),
  }));
  recordWrite?.();
  return Object.freeze({ activation: running, inputs: Object.freeze(linked) });
}

export function getSessionTurnInputs(
  data: MemoryRuntimeData,
  namespace: string,
  sessionId: string,
  workId: string,
): readonly RuntimeSessionInputRecord[] {
  return Object.freeze(
    [...data.sessionInputs.values()]
      .filter(
        (input) =>
          input.namespace === namespace &&
          input.sessionId === sessionId &&
          input.work?.workId === workId,
      )
      .sort((left, right) => left.cursor - right.cursor),
  );
}

export function claimSessionStepInputs(
  data: MemoryRuntimeData,
  input: ClaimRuntimeSessionStepInputsInput,
  recordWrite?: MemoryWriteRecorder,
): RuntimeSessionStepInputClaim {
  const session = currentSession(data, input);
  if (!sessionAcceptsWorkMutation(session)) {
    throw new Error(
      `Session "${input.sessionId}" no longer holds commit authority.`,
    );
  }
  const activation = session.activation;
  if (
    !activation ||
    activation.workId !== input.workId ||
    activation.state !== "running"
  ) {
    throw new Error(`Session activation "${input.workId}" is not running.`);
  }
  const linked = turnInputs(data, input, input.workId);
  const lastCursor = linked.at(-1)?.cursor ?? session.processedCursor ?? 0;
  const newlyClaimed = consecutiveInputsFrom(data, session, lastCursor + 1);
  const candidates = [...linked, ...newlyClaimed].filter(
    (accepted) => !accepted.delivery,
  );
  const deliveredAt = input.now.toISOString();
  const delivered = candidates.map((accepted) =>
    Object.freeze({
      ...accepted,
      work:
        accepted.work ??
        Object.freeze({
          workId: activation.workId,
          target: activation.target,
          state: "running" as const,
        }),
      delivery: Object.freeze({
        stepIndex: input.stepIndex,
        reason: input.reason,
        deliveredAt,
      }),
    }),
  );
  for (const accepted of delivered) {
    data.sessionInputs.set(
      scopedKey(input.namespace, accepted.inputId),
      accepted,
    );
  }
  if (delivered.length > 0) recordWrite?.();
  const replayable = turnInputs(data, input, input.workId).filter(
    (accepted) =>
      accepted.delivery?.stepIndex === input.stepIndex &&
      accepted.delivery.reason === input.reason,
  );
  return Object.freeze({
    acceptedCursor: session.acceptedCursor,
    inputs: Object.freeze(replayable),
  });
}

function consecutiveInputs(
  data: MemoryRuntimeData,
  session: RuntimeSessionRecord,
): readonly RuntimeSessionInputRecord[] {
  return consecutiveInputsFrom(
    data,
    session,
    (session.processedCursor ?? 0) + 1,
  );
}

function consecutiveInputsFrom(
  data: MemoryRuntimeData,
  session: RuntimeSessionRecord,
  firstCursor: number,
): readonly RuntimeSessionInputRecord[] {
  const byCursor = new Map(
    [...data.sessionInputs.values()]
      .filter(
        (input) =>
          input.namespace === session.namespace &&
          input.sessionId === session.sessionId,
      )
      .map((input) => [input.cursor, input]),
  );
  const claimed: RuntimeSessionInputRecord[] = [];
  for (
    let cursor = firstCursor;
    cursor <= session.acceptedCursor;
    cursor += 1
  ) {
    const accepted = byCursor.get(cursor);
    if (!accepted || accepted.work) break;
    claimed.push(accepted);
  }
  return claimed;
}

function turnInputs(
  data: MemoryRuntimeData,
  input: RuntimeSessionTurnInput,
  workId: string,
): readonly RuntimeSessionInputRecord[] {
  return getSessionTurnInputs(data, input.namespace, input.sessionId, workId);
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
