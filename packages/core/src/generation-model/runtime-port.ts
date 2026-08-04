import type { AgentExecutor } from "../agent/executor";

/** Adapter-owned execution authority carried by a bound generation model. */
export interface GenerationRuntimePort {
  /** Create the executor used for provider-neutral Agent execution. */
  createAgentExecutor(): AgentExecutor;
}

export const generationRuntime: unique symbol = Symbol(
  "crux.generation-runtime",
);
