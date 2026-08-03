/** Exported-Flow Work reconnection entry point. */

import type { WorkHandle } from "./handle";
import type { AnyFlowTarget, WorkTargetOutput } from "./target-types";
import { reconnectDurableWork } from "./internal/durable-host-context";

/**
 * Reconnect a handle for a previously accepted Flow Work occurrence.
 *
 * @remarks The ID is an ordinary string. The active Work host validates that
 * the occurrence belongs to the supplied exported Flow.
 * @param target - Exported Flow whose result type defines the returned handle.
 * @param id - Work occurrence identity.
 * @returns A handle whose `result()` resolves to the Flow's exact output.
 */
export async function getWork<const TTarget extends AnyFlowTarget>(
  target: TTarget,
  id: string,
): Promise<WorkHandle<WorkTargetOutput<TTarget>>> {
  return reconnectDurableWork(target.name, id);
}
