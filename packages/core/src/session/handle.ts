/** Build frozen public Session handles for Agent and Flow targets. */

import { isAgent } from "../agent";
import type { GenerationModel } from "../generation-model";
import type { ResolvedRuntimeEngine } from "../runtime/api/create-runtime";
import type { RuntimeSessionRecord } from "../runtime/ports/sessions";
import type { Storage } from "../storage";
import { createThreadHandle } from "../thread/thread";
import type { AnyFlowTarget } from "../work/target-types";
import {
  readSessionInspection,
  readSessionStats,
  readSessionStatus,
} from "./inspection";
import { sessionInputRecord, sessionInputValue } from "./input";
import { SessionInputError } from "./errors";
import {
  closeSession,
  deleteSession,
  forkSessionRecord,
  killSession,
  lineageFromRecord,
  listSessionForks,
} from "./lifecycle";
import { listSessionSubscriptions, subscribeSession } from "./subscribe";
import { requireSessionForStream, sessionStream } from "./stream";
import type { SessionStreamOptions } from "./events";
import type { SessionForTarget, SessionTarget } from "./target-types";
import { acceptSessionTurns } from "./turn-admission";
import { requireCompatibleModel } from "./model-guard";

/** Construct the frozen public handle for one ready Session record. */
export function createSessionHandle<TTarget extends SessionTarget>(
  runtime: ResolvedRuntimeEngine,
  record: RuntimeSessionRecord,
  target: TTarget,
  storage: Storage,
  selectedModel?: GenerationModel,
): SessionForTarget<TTarget> {
  // Scope reads by owner id without auto-registration: Session create/fork
  // own registration, and post-delete reads must not resurrect owners.
  const thread = createThreadHandle(
    { id: record.threadId, storage },
    { id: record.sessionId, state: "open" },
    { registerOwner: false },
  );
  const accept = async (inputs: readonly unknown[]) => {
    if (inputs.length === 0) return Object.freeze([]);
    const parsedInputs = validateInputs(target, inputs);
    if (isAgent(target)) {
      requireCompatibleModel(target, selectedModel ?? target.model);
    }
    return acceptSessionTurns(runtime, record, parsedInputs);
  };
  const forkChild = async () => {
    const child = await forkSessionRecord(runtime, record, storage);
    return createSessionHandle(runtime, child, target, storage, selectedModel);
  };
  const stream = async function* (options?: SessionStreamOptions) {
    await requireSessionForStream(runtime, record.sessionId);
    yield* sessionStream(runtime, record.sessionId, options);
  };
  const base = {
    id: record.sessionId,
    thread: Object.freeze({ id: thread.id, read: thread.read }),
    ...(lineageFromRecord(record)
      ? { forkedFrom: lineageFromRecord(record) }
      : {}),
    send: async (input: unknown) => (await accept([input]))[0]!,
    sendMany: async (inputs: readonly unknown[]) => accept(inputs),
    status: () => readSessionStatus(runtime, record.sessionId),
    inspect: () => readSessionInspection(runtime, record.sessionId),
    stats: () => readSessionStats(runtime, record.sessionId),
    stream,
    subscribe: (source: unknown) => subscribeSession(runtime, record, source),
    subscriptions: () => listSessionSubscriptions(runtime, record),
    close: () => closeSession(runtime, record, storage),
    kill: () => killSession(runtime, record, storage),
    delete: () => deleteSession(runtime, record, storage),
    fork: forkChild,
    clone: forkChild,
    forks: () => listSessionForks(runtime, record),
  };
  if (isFlowSessionTarget(target)) {
    return Object.freeze({
      ...base,
      targetKind: "flow" as const,
    }) as unknown as SessionForTarget<TTarget>;
  }
  return Object.freeze({
    ...base,
    targetKind: "agent" as const,
  }) as unknown as SessionForTarget<TTarget>;
}

function validateInputs(target: SessionTarget, inputs: readonly unknown[]) {
  if (isAgent(target)) {
    const schema = target.prompt.inputSchema;
    if (!schema) {
      throw new SessionInputError(
        `Agent "${target.id}" has no Prompt input schema for Session acceptance.`,
      );
    }
    return inputs.map((input) => {
      let parsed: unknown;
      try {
        parsed = schema.parse(input);
      } catch (cause) {
        throw new SessionInputError(
          `Session input does not match Agent "${target.id}" Prompt input schema.`,
          { cause },
        );
      }
      // Agent Prompt resolution requires a JSON object after schema parse.
      return sessionInputRecord(sessionInputValue(parsed));
    });
  }
  // Flow Session inputs are any JSON-safe value, including void → null and primitives.
  return inputs.map((input) =>
    sessionInputValue(input === undefined ? null : input),
  );
}

function isFlowSessionTarget(value: SessionTarget): value is AnyFlowTarget {
  return !isAgent(value);
}
