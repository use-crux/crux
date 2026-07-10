/**
 * Runtime Engine helpers for workspace watch events.
 *
 * @module
 */

import { getHooks } from "../../runtime/runtime";
import type { ResolvedRuntimeEngine } from "../../runtime/api/create-runtime";
import { createRuntimeWithHostContext } from "../../runtime/api/host-context";
import { runtimeRequiredError } from "../../runtime/api/runtime-required";
import {
  runtimeTargetMap,
  type RuntimeTargetRuntimeRef,
} from "../../runtime/api/target-registry";
import {
  WORKSPACE_CHANGE_EVENT_NAME,
  workspaceChangePayload,
  type WorkspaceChangeEmitter,
} from "./events";

/** Create an emitter that appends workspace changes when a runtime is available. */
export function createWorkspaceChangeEmitter(): WorkspaceChangeEmitter {
  return async (change) => {
    await withOptionalWorkspaceRuntime(async (runtime) => {
      await runtime.kernel.emitEvent({
        namespace: runtime.namespace,
        name: WORKSPACE_CHANGE_EVENT_NAME,
        payload: workspaceChangePayload(change),
      });
    });
  };
}

/** Resolve the runtime required by `workspace.watch()`. */
export function createWorkspaceWatchRuntime(): ResolvedRuntimeEngine {
  const runtimeDefinition = getHooks().runtimeEngine;
  if (!runtimeDefinition) {
    throw runtimeRequiredError({ api: "workspace.watch()" });
  }
  return createWorkspaceRuntime(runtimeDefinition);
}

async function withOptionalWorkspaceRuntime(
  fn: (runtime: ResolvedRuntimeEngine) => Promise<void>,
): Promise<void> {
  const runtimeDefinition = getHooks().runtimeEngine;
  if (!runtimeDefinition) return;

  let runtime: ResolvedRuntimeEngine | undefined;
  try {
    runtime = createWorkspaceRuntime(runtimeDefinition);
  } catch (error) {
    logWorkspaceRuntimeWarning("create runtime", error);
    return;
  }

  try {
    await fn(runtime);
  } catch (error) {
    logWorkspaceRuntimeWarning("emit change event", error);
    // Workspace mutations have already succeeded by the time change events are
    // emitted. Watch delivery is best-effort and must not reject the mutation.
  } finally {
    try {
      runtime.dispose();
    } catch (error) {
      logWorkspaceRuntimeWarning("dispose runtime", error);
      // Best-effort emitters should not surface cleanup failures to callers.
    }
  }
}

function createWorkspaceRuntime(
  runtimeDefinition: NonNullable<ReturnType<typeof getHooks>["runtimeEngine"]>,
): ResolvedRuntimeEngine {
  const runtimeRef: RuntimeTargetRuntimeRef = {};
  const runtime = createRuntimeWithHostContext({
    runtime: runtimeDefinition,
    targets: runtimeTargetMap(runtimeRef),
    startMaintenance: false,
  });
  runtimeRef.current = runtime;
  return runtime;
}

function logWorkspaceRuntimeWarning(phase: string, error: unknown): void {
  console.warn(
    `[crux] workspace watch event dispatch failed during ${phase}; continuing without interrupting the workspace mutation.`,
    error,
  );
}
