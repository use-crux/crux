/** Exported-Flow Work reconnection entry point. */

import { createRuntimeError } from "../runtime/engine/errors";
import type { WorkHandle } from "./handle";
import type { AnyFlowTarget, WorkTargetOutput } from "./target-types";

/**
 * Reconnect a handle for a previously accepted Flow Work occurrence.
 *
 * @remarks The ID is an ordinary string. Runtime target validation and host
 * reconnection behavior are introduced by the later durable runtime slice.
 * @param target - Exported Flow whose result type defines the returned handle.
 * @param id - Work occurrence identity.
 * @returns A handle whose `result()` resolves to the Flow's exact output.
 */
export async function getWork<const TTarget extends AnyFlowTarget>(
  target: TTarget,
  id: string,
): Promise<WorkHandle<WorkTargetOutput<TTarget>>> {
  void target;
  void id;
  throw createRuntimeError({
    code: "CAPABILITY_MISSING",
    whatFailed: "getWork() cannot reconnect durable Flow Work in this host yet.",
    why: "The durable application Work bridge is not installed.",
    whatStillWorks: "Foreground flow.run() remains available.",
    nextStep: "Use flow.run() until a durable Work-capable Runtime host is configured.",
  });
}
