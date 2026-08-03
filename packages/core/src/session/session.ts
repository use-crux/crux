import type { AnyAgent, InferAgentInput } from "../agent";
import { sha256Hex } from "../content/sha256";
import type { RuntimeSessionRecord } from "../runtime/ports/sessions";
import { resolveRecords } from "../runtime/runtime";
import type { Storage } from "../storage";
import { registerThreadOwner } from "../thread/owner";
import { createThreadHandle } from "../thread/thread";
import { activeSessionHost } from "../work/internal/durable-host-context";
import {
  SessionCapabilityError,
  SessionIdentityConflictError,
  SessionInputError,
  SessionNotFoundError,
} from "./errors";
import { sessionInputValue } from "./input";
import type { Session, SessionFor, SessionOptions } from "./types";

const encoder = new TextEncoder();

/**
 * Create or reopen one inert keyed Session for an Agent.
 *
 * @param target - Agent that exclusively owns the key and validates inputs.
 * @param options - Required stable key bound to one Agent within a Runtime namespace.
 * @returns A frozen handle after its durable Thread owner is ready.
 * @throws {SessionIdentityConflictError} If the key belongs to another Agent.
 * @throws {SessionCapabilityError} If the configured stores cannot persist it.
 */
export async function session<const TAgent extends AnyAgent>(
  target: TAgent,
  options: SessionOptions,
): Promise<SessionFor<TAgent>> {
  return createSession(target, options.key);
}

/**
 * Retrieve an existing inert keyed Session without creating one.
 *
 * @param target - Original Agent target bound when the Session was created.
 * @param key - Stable key bound to one Agent within the active Runtime namespace.
 * @returns A frozen handle after any interrupted owner preparation is repaired.
 * @throws {SessionNotFoundError} If no Session exists for the key.
 * @throws {SessionIdentityConflictError} If the key belongs to another Agent.
 */
export async function getSession<const TAgent extends AnyAgent>(
  target: TAgent,
  key: string,
): Promise<SessionFor<TAgent>> {
  assertSessionKey(key);
  const host = activeSessionHost("getSession()");
  const sessions = host.runtime.store.sessions;
  if (!sessions) throw sessionCapabilityError();
  const record = await sessions.getByKey(
    host.runtime.namespace,
    identityHash(host.runtime.namespace, key),
  );
  if (!record) throw new SessionNotFoundError(key);
  if (record.targetId !== target.id)
    throw new SessionIdentityConflictError(key);
  return readyHandle(host.runtime, record, target, resolveStorage());
}

async function createSession<TAgent extends AnyAgent>(
  target: TAgent,
  key: string,
): Promise<SessionFor<TAgent>> {
  assertSessionKey(key);
  const host = activeSessionHost("session()");
  const sessions = host.runtime.store.sessions;
  if (!sessions) throw sessionCapabilityError();
  const storage = resolveStorage();
  const keyHash = identityHash(host.runtime.namespace, key);
  const targetId = target.id;
  const targetKeyHash = identityHash(host.runtime.namespace, targetId, key);
  const created = await host.runtime.store.transact(async (tx) => {
    const port = tx.sessions;
    if (!port) throw sessionCapabilityError();
    return port.create({
      namespace: host.runtime.namespace,
      sessionId: `session_${targetKeyHash}`,
      keyHash,
      targetId,
      threadId: `thread_${targetKeyHash}`,
      now: host.runtime.now(),
    });
  });
  if (created.kind === "conflict") throw new SessionIdentityConflictError(key);
  return readyHandle(host.runtime, created.session, target, storage);
}

async function readyHandle<TAgent extends AnyAgent>(
  runtime: ReturnType<typeof activeSessionHost>["runtime"],
  record: RuntimeSessionRecord,
  target: TAgent,
  storage: Storage,
): Promise<SessionFor<TAgent>> {
  let ready = record;
  if (ready.state === "prepared") {
    await registerThreadOwner(storage, ready.threadId, {
      id: ready.sessionId,
      state: "open",
    });
    ready = await runtime.store.transact(async (tx) => {
      const sessions = tx.sessions;
      if (!sessions) throw sessionCapabilityError();
      return sessions.markReady(
        runtime.namespace,
        record.sessionId,
        runtime.now(),
      );
    });
  }
  return createHandle(runtime, ready, target, storage);
}

function assertSessionKey(key: string): void {
  if (typeof key !== "string" || key.length === 0) {
    throw new TypeError("Session key must not be empty.");
  }
}

function createHandle<TAgent extends AnyAgent>(
  runtime: ReturnType<typeof activeSessionHost>["runtime"],
  record: RuntimeSessionRecord,
  target: TAgent,
  storage: Storage,
): SessionFor<TAgent> {
  const thread = createThreadHandle(
    { id: record.threadId, storage },
    { id: record.sessionId, state: "open" },
  );
  const accept = async (inputs: readonly unknown[]) => {
    if (inputs.length === 0) return Object.freeze([]);
    const parsedInputs = validateInputs(target, inputs);
    const accepted = await runtime.store.transact(async (tx) => {
      const sessions = tx.sessions;
      if (!sessions) throw sessionCapabilityError();
      return sessions.acceptInputs({
        namespace: runtime.namespace,
        sessionId: record.sessionId,
        inputs: parsedInputs,
        now: runtime.now(),
      });
    });
    return Object.freeze(
      accepted.map(({ acceptedAt, cursor, inputId }) =>
        Object.freeze({
          id: inputId,
          cursor: String(cursor),
          acceptedAt: new Date(acceptedAt),
        }),
      ),
    );
  };
  return Object.freeze({
    id: record.sessionId,
    thread: Object.freeze({ id: thread.id, read: thread.read }),
    send: async (input: InferAgentInput<TAgent>) => (await accept([input]))[0]!,
    sendMany: async (inputs: readonly InferAgentInput<TAgent>[]) =>
      accept(inputs),
  }) as Session<InferAgentInput<TAgent>>;
}

function resolveStorage(): Storage {
  return Object.freeze({ records: resolveRecords() });
}

function validateInputs(target: AnyAgent, inputs: readonly unknown[]) {
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
    return sessionInputValue(parsed);
  });
}

function identityHash(...parts: readonly string[]): string {
  return sha256Hex(
    encoder.encode(JSON.stringify(["crux-session:v1", ...parts])),
  );
}

function sessionCapabilityError(): Error {
  return new SessionCapabilityError();
}
