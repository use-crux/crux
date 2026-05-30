/**
 * AgentExecutor — SDK-agnostic interface for executing agents.
 *
 * Each adapter (`@crux/ai`, `@crux/openai`) implements this interface
 * to bridge `Agent` instances to their SDK's `generate()` function.
 * Composition utilities use the executor internally — users don't
 * interact with it directly.
 *
 * @module
 */

import type { AnyAgent } from './agent'
import type { AnyModel, AnyToolSet } from '../types'
import type { ValidationRetryOptions } from '../validation-retry'

// ── Types ───────────────────────────────────────────────────────────

/** The result of executing an agent. */
export interface AgentResult<TOutput = unknown> {
  /** Agent identifier. */
  agentId: string
  /** The output (typed from prompt's outputSchema, or string for text prompts). */
  output: TOutput
  /** Duration in milliseconds. */
  durationMs: number
  /** Token usage if available. */
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number }
}

/** Options passed to the executor for a single agent invocation. */
export interface ExecuteOptions {
  /** Input data for the agent's prompt. */
  input: unknown
  /** Model to use (composition-level default; agent model takes precedence). */
  model?: AnyModel
  /** Additional tools to merge with agent tools. */
  tools?: AnyToolSet
  /**
   * Maximum number of tool-use steps the executor may perform per invocation.
   *
   * When an LLM response contains tool calls, the executor executes the tools
   * and feeds results back for another generation round. This repeats until the
   * LLM responds without tool calls or `maxSteps` is reached.
   *
   * @default 1 — single generation, no tool loop (backward compatible).
   */
  maxSteps?: number
  /**
   * Validation-feedback retry for structured output.
   * Forwarded to the adapter's `generate()` call.
   */
  validationRetry?: ValidationRetryOptions
}

/**
 * SDK-agnostic executor function.
 *
 * Each adapter implements this to call their SDK's `generate()` function.
 * The executor resolves the model as `agent.model ?? options.model`.
 *
 * @param agent - The agent to execute.
 * @param options - Execution options (input, model, tools).
 * @returns The agent's result.
 *
 * @example
 * ```ts
 * // In @crux/ai adapter:
 * const executor: AgentExecutor = async (agent, options) => {
 *   const model = agent.model ?? options.model
 *   const result = await generate(agent.prompt, { model, input: options.input })
 *   return { agentId: agent.id, output: result.object, durationMs: ... }
 * }
 * ```
 */
export interface AgentExecutor {
  (agent: AnyAgent, options: ExecuteOptions): Promise<AgentResult>
}
