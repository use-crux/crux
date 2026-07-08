/**
 * Routing context injected for agent-owned model selection.
 *
 * Agent routing is adapter-owned execution metadata, not prompt input. Keeping
 * it here lets routers classify by agent identity or composition phase without
 * leaking those fields into prompt schemas.
 *
 * @module
 */

import type { ExecutionContext } from "../runtime/execution-context";
import type { AnyAgent } from "./agent";

/** Metadata exposed as `context.agent` to routing classifiers. */
export interface AgentRoutingContext {
  /** The `agent({ id })` value for the agent being executed. */
  readonly id: string;
  /**
   * Composition-local phase label.
   *
   * For composed agents this is the public step label (`reviewer`,
   * `tool-summary`, and so on). Direct agent execution uses `"run"`.
   */
  readonly phase: string;
}

/** Build the routing context fragment injected for an agent model call. */
export function agentRoutingContext(
  agent: AnyAgent,
  executionContext: ExecutionContext | undefined,
): { readonly agent: AgentRoutingContext } {
  return {
    agent: {
      id: agent.id,
      phase: executionContext?.stepLabel ?? "run",
    },
  };
}
