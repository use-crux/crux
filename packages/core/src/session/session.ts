import type { AnyAgent, InferAgentInput, InferAgentOutput } from "../agent";
import { sha256Hex } from "../content/sha256";
import type { RuntimeSessionRecord } from "../runtime/ports/sessions";
import { resolveRecords } from "../runtime/runtime";
import type { Storage } from "../storage";
import { registerThreadOwner } from "../thread/owner";
import { createThreadHandle } from "../thread/thread";
import { activeSessionHost } from "../work/internal/durable-host-context";
import {
  GenerationModelBindingError,
  GenerationModelCapabilityError,
  GenerationModelNotStaticError,
  SessionCapabilityError,
  SessionIdentityConflictError,
  SessionInputError,
  SessionNotFoundError,
} from "./errors";
import { sessionInputRecord, sessionInputValue } from "./input";
import type { GenerationModel } from "../generation-model";
import { acceptSessionTurns } from "./turn-admission";
import type { SessionFor, SessionModelGuard, SessionOptions } from "./types";
import {
  readSessionInspection,
  readSessionStats,
  readSessionStatus,
} from "./inspection";
import { registerSessionInspectableResource } from "./runtime-read-model";

const encoder = new TextEncoder();

/**
 * Create or reopen one inert keyed durable Agent Session.
 *
 * @param target - Agent that exclusively owns the key and validates inputs.
 * @param options - Required stable key and optional immutable GenerationModel override.
 * @returns A frozen handle after its durable Thread owner is ready.
 * @remarks Resolves after durable preparation only; it does not execute the Agent.
 * Selected models must be declared on the active Runtime program.
 * @throws {SessionIdentityConflictError} If the key belongs to another Agent.
 * @throws {SessionCapabilityError} If the configured stores cannot persist it.
 * @throws {GenerationModelBindingError} If neither Session nor Agent binds a model.
 * @throws {GenerationModelNotStaticError} If the model is absent from the program.
 * @throws {GenerationModelCapabilityError} If the model cannot execute the Agent.
 */
export async function session<
  const TAgent extends AnyAgent,
  const TModel extends GenerationModel | undefined = undefined,
>(
  target: TAgent,
  options: SessionOptions<TAgent, TModel> & SessionModelGuard<TAgent, TModel>,
): Promise<SessionFor<TAgent>> {
  const model = requireCompatibleModel(target, options.model ?? target.model);
  return createSession(target, options.key, model);
}

/**
 * Retrieve an existing inert keyed durable Agent Session without creating one.
 *
 * @param target - Original Agent target bound when the Session was created.
 * @param key - Stable key bound to one Agent within the active Runtime namespace.
 * @returns A frozen handle after any interrupted owner preparation is repaired.
 * @remarks Reuses the model pinned at creation; it never substitutes another model.
 * @throws {SessionNotFoundError} If no Session exists for the key.
 * @throws {SessionIdentityConflictError} If the key belongs to another Agent.
 * @throws {SessionCapabilityError} If the configured stores cannot persist it.
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
  const model = resolveProgramModel(host, target, record.model);
  return readyHandle(host.runtime, record, target, resolveStorage(), model);
}

async function createSession<TAgent extends AnyAgent>(
  target: TAgent,
  key: string,
  model: GenerationModel,
): Promise<SessionFor<TAgent>> {
  assertSessionKey(key);
  const host = activeSessionHost("session()");
  assertProgramModel(host, model);
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
      model: Object.freeze({
        definitionId: model.definition.id,
        fingerprint: model.definition.fingerprint,
      }),
      now: host.runtime.now(),
    });
  });
  if (created.kind === "conflict") throw new SessionIdentityConflictError(key);
  return readyHandle(
    host.runtime,
    created.session,
    target,
    storage,
    resolveProgramModel(host, target, created.session.model),
  );
}

async function readyHandle<TAgent extends AnyAgent>(
  runtime: ReturnType<typeof activeSessionHost>["runtime"],
  record: RuntimeSessionRecord,
  target: TAgent,
  storage: Storage,
  model: unknown = target.model,
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
  registerSessionInspectableResource(runtime, ready.sessionId, storage);
  return createHandle(runtime, ready, target, storage, model);
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
  selectedModel: unknown,
): SessionFor<TAgent> {
  const thread = createThreadHandle(
    { id: record.threadId, storage },
    { id: record.sessionId, state: "open" },
  );
  const accept = async (inputs: readonly unknown[]) => {
    if (inputs.length === 0) return Object.freeze([]);
    const parsedInputs = validateInputs(target, inputs);
    requireCompatibleModel(target, selectedModel);
    return acceptSessionTurns<InferAgentOutput<TAgent>>(
      runtime,
      record,
      parsedInputs,
    );
  };
  return Object.freeze({
    id: record.sessionId,
    thread: Object.freeze({ id: thread.id, read: thread.read }),
    send: async (input: InferAgentInput<TAgent>) => (await accept([input]))[0]!,
    sendMany: async (inputs: readonly InferAgentInput<TAgent>[]) =>
      accept(inputs),
    status: () => readSessionStatus(runtime, record.sessionId),
    inspect: () => readSessionInspection(runtime, record.sessionId),
    stats: () => readSessionStats(runtime, record.sessionId),
  });
}

/** Validate the executable model before Session-owned state can change. */
function requireCompatibleModel(
  target: AnyAgent,
  value: unknown,
): GenerationModel {
  if (!isGenerationModel(value)) throw new GenerationModelBindingError();
  const required = ["text-input", "text-output"];
  if (target.prompt.outputSchema) required.push("structured-output");
  if (target.tools && Object.keys(target.tools).length > 0) {
    required.push("tool-calls");
  }
  const missing = required.filter(
    (capability) => !value.capabilities.language.includes(capability as never),
  );
  if (missing.length > 0) throw new GenerationModelCapabilityError(missing);
  return value;
}

function isGenerationModel(value: unknown): value is GenerationModel {
  return (
    typeof value === "object" &&
    value !== null &&
    "_tag" in value &&
    value._tag === "crux.generation-model"
  );
}

function assertProgramModel(
  host: ReturnType<typeof activeSessionHost>,
  model: GenerationModel,
): void {
  const declared = host.generationModels.some(
    (candidate) =>
      candidate.definition.id === model.definition.id &&
      candidate.definition.fingerprint === model.definition.fingerprint,
  );
  if (!declared) throw new GenerationModelNotStaticError();
}

function resolveProgramModel(
  host: ReturnType<typeof activeSessionHost>,
  target: AnyAgent,
  reference: { readonly definitionId: string; readonly fingerprint: string },
): GenerationModel {
  const model = host.generationModels.find(
    (candidate) =>
      candidate.definition.id === reference.definitionId &&
      candidate.definition.fingerprint === reference.fingerprint,
  );
  return requireCompatibleModel(target, model);
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
    return sessionInputRecord(sessionInputValue(parsed));
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
