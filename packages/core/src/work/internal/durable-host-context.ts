/** Request-scoped durable application Work admission. */

import { createAsyncScopeFacet } from "../../async-scope";
import { sha256Hex } from "../../content/sha256";
import { runtimeInputValue } from "../../flow/runtime-engine";
import { createRuntimeWithHostContext } from "../../runtime/api/host-context";
import type { ResolvedRuntimeEngine } from "../../runtime/api/create-runtime";
import type { RuntimeEngineDefinition } from "../../runtime/api/runtime-definition";
import { createRuntimeError } from "../../runtime/engine/errors";
import type { RuntimeProgram } from "../../runtime/program";
import type { RuntimeTargetDefinitionRef } from "../../runtime/ports/target-definition";
import type { FlowId, RuntimeTargetId, WorkId } from "../../runtime/ports/ids";
import type { GenerationModel } from "../../generation-model";
import type { WorkHandle } from "../handle";
import { durableWorkHandle } from "./durable-handle";

const encoder = new TextEncoder();

interface DurableWorkHostContext {
  readonly runtime: ResolvedRuntimeEngine;
  readonly definitions: ReadonlyMap<string, RuntimeTargetDefinitionRef>;
  readonly generationModels: readonly GenerationModel[];
}

const durableWorkHostScope = createAsyncScopeFacet<DurableWorkHostContext>(
  "core.durable-work-host",
);

/** Options accepted by the application-facing durable Work host. */
export interface CreateWorkHostOptions {
  /** Runtime composer supplying durable storage and wake delivery. */
  readonly runtime: RuntimeEngineDefinition;
  /** Generated immutable target program imported by the application. */
  readonly program: RuntimeProgram;
}

/** A Runtime program bound to application Work APIs. */
export interface WorkHost {
  /** Run one request scope in which `spawn()` and `getWork()` are available. */
  run<TResult>(fn: () => TResult): TResult;
  /** Stop host-owned background resources. */
  dispose(): void;
}

/**
 * Bind generated Runtime target metadata to application-facing Work APIs.
 *
 * @remarks Import the generated `runtimeProgram` at the request or application
 * entry after `crux setup` has created it. Acceptance persists through the
 * configured Runtime store; this host does not execute targets inline.
 *
 * @example
 * ```ts
 * import { createWorkHost, spawn } from '@use-crux/core'
 * import { runtimeProgram } from './.crux/generated/runtime/program'
 *
 * const workHost = createWorkHost({ runtime, program: runtimeProgram })
 * const work = await workHost.run(() =>
 *   spawn(review, input, { idempotencyKey: requestId }),
 * )
 * ```
 */
export function createWorkHost(options: CreateWorkHostOptions): WorkHost {
  const runtime = createRuntimeWithHostContext({
    runtime: options.runtime,
    targets: {},
    startMaintenance: false,
  });
  const definitions = new Map<string, RuntimeTargetDefinitionRef>();
  for (const definition of options.program.targetDefinitions) {
    definitions.set(
      definition.targetId,
      Object.freeze({
        ...definition,
        manifestHash: options.program.manifestHash,
      }),
    );
  }
  const context = Object.freeze({
    runtime,
    definitions,
    generationModels: options.program.generationModels,
  });
  return Object.freeze({
    run: <TResult>(fn: () => TResult) => durableWorkHostScope.run(context, fn),
    dispose: () => runtime.dispose(),
  });
}

/** Accept or reconnect one idempotent top-level Flow Work occurrence. @internal */
export async function acceptDurableWork<TResult>(
  targetId: string,
  input: unknown,
  idempotencyKey: string,
): Promise<WorkHandle<TResult>> {
  const context = activeHost("spawn()");
  const definition = targetDefinition(context, targetId, "spawn()");
  const identity = workIdentity(
    context.runtime.namespace,
    targetId,
    idempotencyKey,
  );
  const accepted = await context.runtime.kernel.acceptWork({
    namespace: context.runtime.namespace,
    workId: identity.workId,
    flowId: identity.flowId,
    targetId: definition.targetId,
    definition,
    input: runtimeInputValue(input),
    effects: identity.effects,
    deliveryKey: `work.accept:${identity.hash}`,
  });
  return durableWorkHandle<TResult>(
    context.runtime,
    accepted.work,
    accepted.snapshot,
  );
}

/** Reconnect one existing top-level Flow Work occurrence. @internal */
export async function reconnectDurableWork<TResult>(
  targetId: string,
  id: string,
): Promise<WorkHandle<TResult>> {
  const context = activeHost("getWork()");
  targetDefinition(context, targetId, "getWork()");
  const work = await context.runtime.store.state.getWork(id as WorkId, {
    namespace: context.runtime.namespace,
  });
  if (!work || work.work.kind !== "flow.resume") {
    throw workNotFound(id);
  }
  const snapshot = await context.runtime.store.state.getSnapshot(
    work.work.flowId,
    {
      namespace: context.runtime.namespace,
    },
  );
  if (!snapshot) throw workNotFound(id);
  if (work.targetId !== targetId || snapshot.targetId !== targetId) {
    throw createRuntimeError({
      code: "WORK_TARGET_MISMATCH",
      whatFailed: `Work \`${id}\` does not belong to target \`${targetId}\`.`,
      why: "getWork() requires the same exported Flow target used at acceptance.",
      whatStillWorks:
        "The accepted Work remains unchanged and reconnectable with its original target.",
      nextStep: "Pass the original exported Flow to getWork().",
    });
  }
  return durableWorkHandle<TResult>(context.runtime, work, snapshot);
}

function activeHost(api: string): DurableWorkHostContext {
  const context = durableWorkHostScope.current();
  if (context) return context;
  throw createRuntimeError({
    code: "RUNTIME_REQUIRED",
    whatFailed: `${api} requires an active durable Work host.`,
    why: "No generated Runtime program is bound in this request scope.",
    whatStillWorks: "Foreground flow.run() remains available.",
    nextStep: "Create a Work host and call this API inside workHost.run().",
  });
}

/** Read the active application Runtime host for Session admission. @internal */
export function activeSessionHost(api: string): DurableWorkHostContext {
  return activeHost(api);
}

function targetDefinition(
  context: DurableWorkHostContext,
  targetId: string,
  api: string,
): RuntimeTargetDefinitionRef {
  const definition = context.definitions.get(targetId);
  if (definition) return definition;
  throw createRuntimeError({
    code: "TARGET_NOT_EXPORTED",
    whatFailed: `Runtime target \`${targetId}\` is not exported by the bound generated program.`,
    why: `${api} accepts only immutable target metadata discovered during generation.`,
    whatStillWorks:
      "Other exported Flow targets in the generated program remain available.",
    nextStep:
      "Export the Flow and run `crux runtime generate` before starting this host.",
  });
}

function workIdentity(namespace: string, targetId: string, key: string) {
  if (typeof key !== "string" || key.length === 0)
    throw new TypeError("Work idempotencyKey must not be empty.");
  const hash = sha256Hex(
    encoder.encode(JSON.stringify(["crux-work:v1", namespace, targetId, key])),
  );
  const workId = `work_${hash}` as WorkId;
  const flowId = `flow_${hash}` as FlowId;
  return Object.freeze({
    hash,
    workId,
    flowId,
    effects: Object.freeze({
      kind: "effect.scope" as const,
      id: `effect_${hash}`,
      // Flow opens the boundary with the Flow id as runId; keep admission identity
      // aligned so Work.effects is the same scope execution and recovery use.
      runId: flowId,
    }),
  });
}

function workNotFound(id: string): Error {
  return createRuntimeError({
    code: "TARGET_NOT_FOUND",
    whatFailed: `Work \`${id}\` was not found in this Runtime namespace.`,
    why: "The Work was never accepted here or its retained control record expired.",
    whatStillWorks: "Other retained Work occurrences remain reconnectable.",
    nextStep:
      "Check the Work id and Runtime namespace before retrying getWork().",
  });
}
