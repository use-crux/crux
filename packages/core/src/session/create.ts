/** Shared durable Session record creation for Agent and Flow targets. */

import type { AnyAgent } from "../agent";
import { sha256Hex } from "../content/sha256";
import type { GenerationModel } from "../generation-model";
import { createRuntimeError } from "../runtime/engine/errors";
import type { RuntimeSessionRecord } from "../runtime/ports/sessions";
import type { RuntimeTargetDefinitionRef } from "../runtime/ports/target-definition";
import { resolveRecords } from "../runtime/runtime";
import type { Storage } from "../storage";
import { registerThreadOwner } from "../thread/owner";
import { activeSessionHost } from "../work/internal/durable-host-context";
import type { AnyFlowTarget } from "../work/target-types";
import {
  GenerationModelNotStaticError,
  SessionCapabilityError,
  SessionIdentityConflictError,
} from "./errors";
import { createSessionHandle } from "./handle";
import { requireCompatibleModel } from "./model-guard";
import { registerSessionInspectableResource } from "./runtime-read-model";
import type { SessionForTarget, SessionTarget } from "./target-types";

const encoder = new TextEncoder();

/** Create one Agent Session after GenerationModel preflight. */
export async function createAgentSession<TAgent extends AnyAgent>(
  target: TAgent,
  key: string,
  model: GenerationModel,
): Promise<SessionForTarget<TAgent>> {
  assertSessionKey(key);
  const host = activeSessionHost("session()");
  assertProgramModel(host, model);
  return createSessionRecord(host, {
    key,
    targetId: target.id,
    targetKind: "agent",
    model: Object.freeze({
      definitionId: model.definition.id,
      fingerprint: model.definition.fingerprint,
    }),
    target,
    selectedModel: model,
  });
}

/** Create one Flow Session after exported-target preflight. */
export async function createFlowSession<TFlow extends AnyFlowTarget>(
  target: TFlow,
  key: string,
): Promise<SessionForTarget<TFlow>> {
  assertSessionKey(key);
  const host = activeSessionHost("session()");
  const definition = host.definitions.get(target.name);
  if (!definition) {
    throw createRuntimeError({
      code: "TARGET_NOT_EXPORTED",
      whatFailed: `Runtime target \`${target.name}\` is not exported by the bound generated program.`,
      why: "session() accepts only immutable Flow metadata discovered during generation.",
      whatStillWorks: "Other exported Flow targets remain available.",
      nextStep:
        "Export the Flow and run `crux runtime generate` before starting this host.",
    });
  }
  return createSessionRecord(host, {
    key,
    targetId: target.name,
    targetKind: "flow",
    definition,
    target,
  });
}

/** Finish preparation and return a frozen public handle for one Session record. */
export async function readySessionHandle<TTarget extends SessionTarget>(
  runtime: ReturnType<typeof activeSessionHost>["runtime"],
  record: RuntimeSessionRecord,
  target: TTarget,
  storage: Storage,
  model?: GenerationModel,
): Promise<SessionForTarget<TTarget>> {
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
  return createSessionHandle(runtime, ready, target, storage, model);
}

export function resolveProgramModel(
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

export function resolveStorage(): Storage {
  return Object.freeze({ records: resolveRecords() });
}

export function identityHash(...parts: readonly string[]): string {
  return sha256Hex(
    encoder.encode(JSON.stringify(["crux-session:v1", ...parts])),
  );
}

export function sessionCapabilityError(): Error {
  return new SessionCapabilityError();
}

export function assertSessionKey(key: string): void {
  if (typeof key !== "string" || key.length === 0) {
    throw new TypeError("Session key must not be empty.");
  }
}

async function createSessionRecord<TTarget extends SessionTarget>(
  host: ReturnType<typeof activeSessionHost>,
  input: {
    readonly key: string;
    readonly targetId: string;
    readonly targetKind: "agent" | "flow";
    readonly model?: RuntimeSessionRecord["model"];
    readonly definition?: RuntimeTargetDefinitionRef;
    readonly target: TTarget;
    readonly selectedModel?: GenerationModel;
  },
): Promise<SessionForTarget<TTarget>> {
  const sessions = host.runtime.store.sessions;
  if (!sessions) throw sessionCapabilityError();
  const storage = resolveStorage();
  const keyHash = identityHash(host.runtime.namespace, input.key);
  const targetKeyHash = identityHash(
    host.runtime.namespace,
    input.targetId,
    input.key,
  );
  const created = await host.runtime.store.transact(async (tx) => {
    const port = tx.sessions;
    if (!port) throw sessionCapabilityError();
    return port.create({
      namespace: host.runtime.namespace,
      sessionId: `session_${targetKeyHash}`,
      keyHash,
      targetId: input.targetId,
      targetKind: input.targetKind,
      threadId: `thread_${targetKeyHash}`,
      ...(input.model ? { model: input.model } : {}),
      ...(input.definition ? { definition: input.definition } : {}),
      now: host.runtime.now(),
    });
  });
  if (created.kind === "conflict") {
    throw new SessionIdentityConflictError(input.key);
  }
  return readySessionHandle(
    host.runtime,
    created.session,
    input.target,
    storage,
    input.selectedModel,
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
