/** Public durable Work entry points. */

import { createRuntimeError } from "../runtime/engine/errors";
import type {
  ExportedFlowTarget,
  SpawnWorkOptions,
  WorkHandle,
  WorkId,
  WorkInput,
} from "./types";

/**
 * Durably accept an exported Flow without executing it inline.
 *
 * @remarks Phase 1 publishes the target-safe contract. Runtime acceptance is
 * deliberately unavailable until the durable host bridge is installed.
 */
export async function spawn<const TTarget extends ExportedFlowTarget>(
  target: TTarget,
  input: WorkInput<NoInfer<TTarget>>,
  options: SpawnWorkOptions,
): Promise<WorkHandle<TTarget>> {
  void target;
  void input;
  void options;
  return durableWorkUnsupported("spawn()");
}

/** Reconnect a target-qualified handle for previously accepted durable Work. */
export async function getWork<const TTarget extends ExportedFlowTarget>(
  target: TTarget,
  id: WorkId<NoInfer<TTarget>>,
): Promise<WorkHandle<TTarget>> {
  void target;
  void id;
  return durableWorkUnsupported("getWork()");
}

function durableWorkUnsupported(api: string): never {
  throw createRuntimeError({
    code: "CAPABILITY_MISSING",
    whatFailed: `${api} cannot accept durable Flow Work in this host yet.`,
    why: "The durable application Work bridge is not installed.",
    whatStillWorks:
      "Foreground flow.run() and process-local Agent Work remain available.",
    nextStep:
      "Use flow.run() until a durable Work-capable Runtime host is configured.",
  });
}
