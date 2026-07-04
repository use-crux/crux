/**
 * Runtime Engine helpers for workspace watch events.
 *
 * @module
 */

import { getRuntime } from "../../runtime/runtime";
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
  const runtimeDefinition = getRuntime().runtimeEngine;
  if (!runtimeDefinition) {
    throw runtimeRequiredError({ api: "workspace.watch()" });
  }
  return createWorkspaceRuntime(runtimeDefinition);
}

async function withOptionalWorkspaceRuntime(
  fn: (runtime: ResolvedRuntimeEngine) => Promise<void>,
): Promise<void> {
  const runtimeDefinition = getRuntime().runtimeEngine;
  if (!runtimeDefinition) return;

  let runtime: ResolvedRuntimeEngine | undefined;
  try {
    runtime = createWorkspaceRuntime(runtimeDefinition);
  } catch (error) {
    if (isRuntimeHostOnlyError(error)) return;
    throw error;
  }

  try {
    await fn(runtime);
  } finally {
    runtime.dispose();
  }
}

function createWorkspaceRuntime(
  runtimeDefinition: NonNullable<ReturnType<typeof getRuntime>["runtimeEngine"]>,
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

function isRuntimeHostOnlyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === "RUNTIME_HOST_ONLY"
  );
}
