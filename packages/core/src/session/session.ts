/** Public durable Session create/get for Agent and Flow targets. */

import type { AnyAgent } from "../agent";
import { isAgent } from "../agent";
import type { GenerationModel } from "../generation-model";
import { activeSessionHost } from "../work/internal/durable-host-context";
import type { AnyFlowTarget } from "../work/target-types";
import {
  SessionDeletedError,
  SessionIdentityConflictError,
  SessionNotFoundError,
} from "./errors";
import type {
  AgentSessionOptions,
  FlowSessionOptions,
  SessionForTarget,
  SessionTarget,
} from "./target-types";
import { requireCompatibleModel } from "./model-guard";
import {
  assertSessionKey,
  createAgentSession,
  createFlowSession,
  identityHash,
  readySessionHandle,
  resolveProgramModel,
  resolveStorage,
  sessionCapabilityError,
} from "./create";

/**
 * Create or reopen one inert keyed durable Session for an Agent target.
 *
 * @param target - Agent that exclusively owns the key and validates inputs.
 * @param options - Required stable key and optional immutable GenerationModel override.
 * @returns A frozen handle after its durable Thread owner is ready.
 * @remarks Resolves after durable preparation only; it does not execute the Agent.
 * Selected models must be declared on the active Runtime program.
 * @throws {SessionIdentityConflictError} If the key belongs to another target.
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
  options: AgentSessionOptions<TAgent, TModel>,
): Promise<SessionForTarget<TAgent>>;
/**
 * Create or reopen one inert keyed durable Session for an exported Flow target.
 *
 * @param target - Exported Flow that exclusively owns the key and validates inputs.
 * @param options - Required stable key.
 * @returns A frozen handle after its durable Thread owner is ready.
 * @remarks Resolves after durable preparation only; it does not execute the Flow.
 * @throws {SessionIdentityConflictError} If the key belongs to another target.
 * @throws {SessionCapabilityError} If the configured stores cannot persist it.
 */
export async function session<const TFlow extends AnyFlowTarget>(
  target: TFlow,
  options: FlowSessionOptions,
): Promise<SessionForTarget<TFlow>>;
export async function session(
  target: SessionTarget,
  options: { readonly key: string; readonly model?: GenerationModel },
): Promise<SessionForTarget<SessionTarget>> {
  if (isAgent(target)) {
    const model = requireCompatibleModel(target, options.model ?? target.model);
    return createAgentSession(target, options.key, model);
  }
  if (isFlowTarget(target)) {
    if (options.model !== undefined) {
      throw new TypeError("Flow Sessions do not accept a GenerationModel.");
    }
    return createFlowSession(target, options.key);
  }
  throw unsupportedTargetError("session()");
}

/**
 * Retrieve an existing inert keyed durable Session without creating one.
 *
 * @param target - Original target bound when the Session was created.
 * @param key - Stable key bound to one target within the active Runtime namespace.
 * @returns A frozen handle after any interrupted owner preparation is repaired.
 * @remarks Reuses the model or definition pinned at creation.
 * @throws {SessionNotFoundError} If no Session exists for the key.
 * @throws {SessionIdentityConflictError} If the key belongs to another target.
 * @throws {SessionCapabilityError} If the configured stores cannot persist it.
 */
export async function getSession<const TTarget extends SessionTarget>(
  target: TTarget,
  key: string,
): Promise<SessionForTarget<TTarget>> {
  assertSessionKey(key);
  const host = activeSessionHost("getSession()");
  const sessions = host.runtime.store.sessions;
  if (!sessions) throw sessionCapabilityError();
  const record = await sessions.getByKey(
    host.runtime.namespace,
    identityHash(host.runtime.namespace, key),
  );
  if (!record) throw new SessionNotFoundError(key);
  if (record.state === "deleted") {
    throw new SessionDeletedError(record.sessionId);
  }
  if (record.targetId !== targetIdentity(target)) {
    throw new SessionIdentityConflictError(key);
  }
  if (isAgent(target)) {
    if (record.targetKind !== "agent" || !record.model) {
      throw new SessionIdentityConflictError(key);
    }
    const model = resolveProgramModel(host, target, record.model);
    return readySessionHandle(
      host.runtime,
      record,
      target,
      resolveStorage(),
      model,
    );
  }
  if (isFlowTarget(target)) {
    if (record.targetKind !== "flow") throw new SessionIdentityConflictError(key);
    return readySessionHandle(host.runtime, record, target, resolveStorage());
  }
  throw unsupportedTargetError("getSession()");
}

function targetIdentity(target: SessionTarget): string {
  return isAgent(target) ? target.id : target.name;
}

function isFlowTarget(value: unknown): value is AnyFlowTarget {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    (value as { kind: unknown }).kind === "flow" &&
    "name" in value &&
    typeof (value as { name: unknown }).name === "string" &&
    "run" in value &&
    typeof (value as { run: unknown }).run === "function"
  );
}

function unsupportedTargetError(api: string): never {
  throw new TypeError(
    `${api} rejected an unsupported Session target. Pass a frozen agent() or flow() definition exported by the Runtime program.`,
  );
}
