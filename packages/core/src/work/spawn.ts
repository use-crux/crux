/** Exported-Flow Work admission entry point. */

import { createRuntimeError } from "../runtime/engine/errors";
import type { WorkHandle } from "./handle";
import type {
  AnyFlowTarget,
  SpawnWorkArgs,
  WorkTargetOutput,
} from "./target-types";

/**
 * Accept an exported Flow as Work without executing it inline.
 *
 * @remarks `spawn()` is for joinable finite Work. Use `defer()` for the
 * existing no-result deferred execution path. Durable host admission is not
 * implemented in this bounded slice, so the current runtime rejects after
 * type-safe argument validation.
 * @param target - Exported Flow definition to accept as Work.
 * @param args - Required Flow input and idempotency key, or only the key for a void-input Flow.
 * @returns A handle whose `result()` resolves to the Flow's exact output.
 */
export async function spawn<const TTarget extends AnyFlowTarget>(
  target: TTarget,
  ...args: SpawnWorkArgs<TTarget>
): Promise<WorkHandle<WorkTargetOutput<TTarget>>> {
  void target;
  void args;
  throw unsupportedWorkHost("spawn()");
}

function unsupportedWorkHost(api: string): Error {
  return createRuntimeError({
    code: "CAPABILITY_MISSING",
    whatFailed: `${api} cannot accept durable Flow Work in this host yet.`,
    why: "The durable application Work bridge is not installed.",
    whatStillWorks: "Foreground flow.run() remains available.",
    nextStep: "Use flow.run() until a durable Work-capable Runtime host is configured.",
  });
}
