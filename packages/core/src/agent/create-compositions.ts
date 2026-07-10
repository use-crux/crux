/**
 * Factory for creating adapter-bound composition utilities.
 *
 * Each SDK adapter (`@use-crux/ai`, `@use-crux/openai`) calls this with their
 * `AgentExecutor` to produce pre-bound `parallel`, `pipeline`, and
 * `consensus` functions that users import directly.
 *
 * @module
 */

import type { AgentExecutor } from './executor'
import { createParallel } from './parallel'
import { createPipeline } from './pipeline'
import { createConsensus } from './consensus'
import { createSwarm } from './swarm'

// ── Factory ─────────────────────────────────────────────────────────

/**
 * Create composition utilities bound to a specific executor.
 *
 * @param executor - SDK-specific agent executor.
 * @returns Frozen object with `parallel`, `pipeline`, `consensus`, and `swarm` functions.
 *
 * @example
 * ```ts
 * // In @use-crux/ai adapter:
 * import { createCompositions } from '@use-crux/core/agent'
 * const { parallel, pipeline, consensus } = createCompositions(myExecutor)
 * export { parallel, pipeline, consensus }
 * ```
 */
export function createCompositions(executor: AgentExecutor) {
  return Object.freeze({
    parallel: createParallel(executor),
    pipeline: createPipeline(executor),
    consensus: createConsensus(executor),
    swarm: createSwarm(executor),
  })
}
