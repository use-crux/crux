/**
 * AgentExecutor — SDK-agnostic interface for executing agents.
 *
 * Each adapter (`@use-crux/ai`, `@use-crux/openai`) implements this interface
 * to bridge `Agent` instances to their SDK's `generate()` function.
 * Composition utilities use the executor internally — users don't
 * interact with it directly.
 *
 * @module
 */

import type { AnyAgent } from './agent'
import type { AnyModel, AnyToolSet } from '../types'
import type { ValidationRetryOptions } from '../generation/validation-retry'
import type { TokenUsage } from '../generation/types'
import type { WithOperationResultMeta } from '../observability'
import type { InputBudget } from '../request/budget/input-budget'
import type { PrepareStep } from '../request/prepare/step'
import type { RequestReceipt } from '../request/receipt/receipt'
import type { ThreadCommit } from '../thread/types'

// ── Types ───────────────────────────────────────────────────────────

/**
 * ID-free facts returned by an adapter or application agent executor.
 *
 * Executors describe what happened but do not own Crux operation identity.
 * The composition runtime adds that identity after the payload is produced.
 */
export interface AgentResultPayload<TOutput = unknown> {
  /** Agent identifier. */
  readonly agentId: string
  /** The output (typed from prompt's outputSchema, or string for text prompts). */
  readonly output: TOutput
  /** Duration in milliseconds. */
  readonly durationMs: number
  /** Token usage if available. */
  readonly usage?: TokenUsage
  /** Ordered provider requests executed by this managed child. */
  readonly requests?: readonly RequestReceipt[]
  /** Atomic canonical Thread publication produced by this Agent invocation. */
  readonly threadCommit?: ThreadCommit
}

/**
 * Result of one public agent execution.
 *
 * `_meta` identifies the exact `agent.run` span that produced this envelope,
 * including when the agent is nested inside a composition or flow step.
 *
 * @example
 * ```ts
 * const child = result.results.reviewer
 * console.log(child._meta.spanId)
 * ```
 */
export type AgentResult<TOutput = unknown> = WithOperationResultMeta<
  AgentResultPayload<TOutput>
>

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
  /** Invocation-level whole-request input pressure overrides. */
  inputBudget?: InputBudget
  /** Invocation callback overriding the Agent default for this run. */
  prepareStep?: PrepareStep<AnyModel>
  /** Tool names exposed from the prepared child baseline. */
  activeTools?: readonly string[]
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
 * @returns ID-free execution facts for Core to finalize at `agent.run`.
 *
 * @example
 * ```ts
 * // In @use-crux/ai adapter:
 * const executor: AgentExecutor = async (agent, options) => {
 *   const model = agent.model ?? options.model
 *   const result = await generate(agent.prompt, { model, input: options.input })
 *   return { agentId: agent.id, output: result.object, durationMs: ... }
 * }
 * ```
 */
export interface AgentExecutor {
  (agent: AnyAgent, options: ExecuteOptions): Promise<AgentResultPayload>
}
