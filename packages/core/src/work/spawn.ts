/** Exported-Flow Work admission entry point. */

import type { SpawnWorkOptions, WorkHandle } from "./handle";
import type {
  AnyFlowTarget,
  SpawnWorkArgs,
  WorkTargetOutput,
} from "./target-types";
import { acceptDurableWork } from "./internal/durable-host-context";

/**
 * Accept an exported Flow as Work without executing it inline.
 *
 * @remarks `spawn()` is for joinable finite Work. Use `defer()` for the
 * existing no-result deferred execution path. The active Work host accepts the
 * occurrence durably and returns before target execution begins.
 * @param target - Exported Flow definition to accept as Work.
 * @param args - Required Flow input and idempotency key, or only the key for a void-input Flow.
 * @returns A handle whose `result()` resolves to the Flow's exact output.
 */
export async function spawn<const TTarget extends AnyFlowTarget>(
  target: TTarget,
  ...args: SpawnWorkArgs<TTarget>
): Promise<WorkHandle<WorkTargetOutput<TTarget>>> {
  const options = args.at(-1)! as SpawnWorkOptions;
  const input = args.length === 1 ? undefined : args[0];
  return acceptDurableWork(target.name, input, options.idempotencyKey);
}
