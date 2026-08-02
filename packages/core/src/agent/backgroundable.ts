/**
 * Marks an Agent as callable through a background Work reference.
 *
 * @module
 */

import type { AnyAgent } from "./agent";

const backgroundableAgentBrand: unique symbol = Symbol("backgroundable-agent");

/** An inert, type-preserving wrapper for an Agent tool that may run in background. */
export interface BackgroundableAgent<TAgent extends AnyAgent> {
  readonly agent: TAgent;
  readonly [backgroundableAgentBrand]: true;
}

/** Mark an Agent for background execution when used in an Agent tool set. */
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
