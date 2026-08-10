/** Work admission entry points for exported Flows and process-local Agents. */

import {
  isAgent,
  type AnyAgent,
  type InferAgentInput,
  type InferAgentOutput,
} from "../agent/agent";
import type { AgentWorkHandle } from "./agent-handle";
import type { SpawnWorkOptions, WorkHandle } from "./handle";
import { acceptProcessLocalAgentWork } from "./agent-host";
import { acceptDurableWork } from "./internal/durable-host-context";
import type {
  AnyFlowTarget,
  SpawnWorkArgs,
  WorkTargetOutput,
} from "./target-types";

/** Argument tuple for process-local Agent Work acceptance. */
export type SpawnAgentArgs<TAgent extends AnyAgent> = [
  InferAgentInput<TAgent>,
] extends [void] | [undefined]
  ? [] | [input: InferAgentInput<TAgent>]
  : [input: InferAgentInput<TAgent>];

/**
 * Accept process-local Agent Work and return a typed Agent handle.
 *
 * @remarks Requires an active {@link createAgentWorkHost} scope. The returned
 * handle supports Agent-only `send()` and does not claim cross-request
 * durability. Flow targets continue to use the durable Work host.
 *
 * @example
 * ```ts
 * const host = createAgentWorkHost({ executor })
 * const child = await host.run(() => spawn(researcher, { task: "Review" }))
 * await child.send("Prioritize primary sources.")
 * const report = await child.result()
 * ```
 */
export async function spawn<const TAgent extends AnyAgent>(
  target: TAgent,
  ...args: SpawnAgentArgs<TAgent>
): Promise<AgentWorkHandle<InferAgentOutput<TAgent>>>;

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
): Promise<WorkHandle<WorkTargetOutput<TTarget>>>;

export async function spawn(
  target: AnyAgent | AnyFlowTarget,
  ...args: unknown[]
): Promise<AgentWorkHandle<unknown> | WorkHandle<unknown>> {
  if (isAgent(target)) {
    const input = args.length === 0 ? undefined : args[0];
    return acceptProcessLocalAgentWork(target, input);
  }

  const options = args.at(-1)! as SpawnWorkOptions;
  const input = args.length === 1 ? undefined : args[0];
  return acceptDurableWork(
    (target as AnyFlowTarget).name,
    input,
    options.idempotencyKey,
  );
}
