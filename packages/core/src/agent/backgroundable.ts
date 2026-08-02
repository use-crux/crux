/**
 * Marks child Agents that a parent model may run as process-local background
 * Work.
 *
 * @module
 */

import type { AnyAgent } from "./agent";

const backgroundableAgentBrand: unique symbol = Symbol("backgroundable-agent");

/**
 * Frozen, inert marker for an Agent that may become a background child Tool.
 *
 * @remarks
 * The marker has no execution behavior by itself. Core binds it only when the
 * value appears in another Agent's `tools` map. The resulting Work reference
 * and control capability are model-facing and strictly process-local; this
 * type is not an application Work handle and provides no durable recovery.
 *
 * @typeParam TAgent - Exact wrapped Agent type, preserved for Tool inference.
 */
export interface BackgroundableAgent<TAgent extends AnyAgent> {
  /** The exact Agent definition that will execute as the child. */
  readonly agent: TAgent;
  readonly [backgroundableAgentBrand]: true;
}

/**
 * Allow a parent model to choose foreground or process-local background
 * execution for a child Agent Tool.
 *
 * @remarks
 * In a `tools` map, the bound child input gains `run_in_background?: boolean`.
 * An absent or false value preserves foreground behavior and returns the exact
 * child result. A true value returns a process-local Work reference; Core then
 * supplies the parent model with its automatic Work control Tool. The child
 * still runs only its own prompt, `use` contributions, and tools; parent
 * prompt, history, and control state are not inherited.
 *
 * @example
 * ```ts
 * import { agent, backgroundable } from "@use-crux/core/agent";
 *
 * const coordinator = agent({
 *   id: "coordinator",
 *   prompt: coordinatorPrompt,
 *   tools: { research: backgroundable(researchAgent) },
 * });
 * ```
 *
 * @typeParam TAgent - Exact child Agent type.
 * @param agent - Child Agent to expose through a background-capable Tool.
 * @returns An immutable, type-preserving marker for use in an Agent `tools` map.
 */
export function backgroundable<TAgent extends AnyAgent>(
  agent: TAgent,
): BackgroundableAgent<TAgent> {
  return Object.freeze({ agent, [backgroundableAgentBrand]: true as const });
}

/** Whether a value is a backgroundable Agent wrapper. @internal */
export function isBackgroundableAgent(
  value: unknown,
): value is BackgroundableAgent<AnyAgent> {
  return typeof value === "object" && value !== null &&
    backgroundableAgentBrand in value;
}
