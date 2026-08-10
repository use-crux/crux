/**
 * Process-local host binding for programmatic Agent Work.
 *
 * @module
 */

import type { AnyAgent } from "../agent/agent";
import type { AgentExecutor } from "../agent/executor";
import { createAsyncScopeFacet } from "../async-scope";
import type { AnyModel } from "../types";
import type { AgentWorkHandle } from "./agent-handle";
import type { InferAgentOutput } from "../agent/agent";
import {
  createProcessLocalAgentWorkController,
  type ProcessLocalAgentWorkController,
} from "./internal/agent-work-controller";
import { createProcessLocalWorkKernel } from "./internal/process-local-kernel";

interface AgentWorkHostContext {
  readonly controller: ProcessLocalAgentWorkController;
  readonly executor: AgentExecutor;
  readonly model?: AnyModel;
}

const agentWorkHostScope = createAsyncScopeFacet<AgentWorkHostContext>(
  "core.process-local-agent-work-host",
);

/** Options for a process-local Agent Work host. */
export interface CreateAgentWorkHostOptions {
  /** Adapter-bound executor used to run accepted Agent Work. */
  readonly executor: AgentExecutor;
  /** Default model forwarded when the Agent does not pin one. */
  readonly model?: AnyModel;
}

/**
 * Bind an Agent executor for process-local `spawn(agent, input)`.
 *
 * @remarks This host does not claim cross-request durability. Process exit
 * loses accepted Work, steering mailboxes, and result promises. Use a durable
 * Runtime host when restart or cross-request rejoin is required.
 *
 * @example
 * ```ts
 * const host = createAgentWorkHost({ executor })
 * const child = await host.run(() => spawn(researcher, { task: "Review" }))
 * await child.send("Prioritize primary sources.")
 * ```
 */
export function createAgentWorkHost(
  options: CreateAgentWorkHostOptions,
): {
  run<TResult>(fn: () => TResult): TResult;
} {
  const kernel = createProcessLocalWorkKernel();
  const controller = createProcessLocalAgentWorkController({ kernel });
  const context = Object.freeze({
    controller,
    executor: options.executor,
    ...(options.model !== undefined ? { model: options.model } : {}),
  });
  return Object.freeze({
    run: <TResult>(fn: () => TResult) => agentWorkHostScope.run(context, fn),
  });
}

/** Accept process-local Agent Work when an Agent Work host is active. @internal */
export async function acceptProcessLocalAgentWork<TAgent extends AnyAgent>(
  agent: TAgent,
  input: unknown,
): Promise<AgentWorkHandle<InferAgentOutput<TAgent>>> {
  const context = agentWorkHostScope.current();
  if (!context) {
    throw new TypeError(
      "spawn(agent) requires createAgentWorkHost({ executor }).run(...). Process-local Agent Work is not ambiently available.",
    );
  }
  return context.controller.spawnAgent(agent, input, {
    executor: context.executor,
    model: context.model,
  });
}

/** Whether the active ambient host can accept process-local Agent Work. @internal */
export function hasProcessLocalAgentWorkHost(): boolean {
  return agentWorkHostScope.current() !== undefined;
}

/** Active controller for first-party binders that share an adapter kernel. @internal */
export function activeProcessLocalAgentWorkController():
  | ProcessLocalAgentWorkController
  | undefined {
  return agentWorkHostScope.current()?.controller;
}
