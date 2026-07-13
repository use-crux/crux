/**
 * Shared in-memory `AgentExecutor` fake for testing the agent compositions.
 *
 * The real executor lives in the adapter packages (`@use-crux/ai`, `@use-crux/openai`)
 * — core only declares the {@link AgentExecutor} contract. To test how
 * `parallel()`, `pipeline()`, `consensus()`, and `swarm()` *drive* an executor
 * (option threading, error bubbling, result accumulation, execution-context
 * threading, instrumentation fan-out) without an SDK, the composition tests
 * need one conformant fake. This is that fake — the agent-layer analogue of
 * the resolver `fakes.ts` re-exported from the root `index.ts`.
 *
 * It is a **test helper**, exported from `@use-crux/core/agent` and the package
 * root so SDK consumers get the same seam the core suite uses.
 *
 * @example
 * ```ts
 * const executor = createFakeAgentExecutor({
 *   agents: {
 *     reviewer: { output: { score: 0.9 } },
 *     triage: { transfer: 'billing', reason: 'billing issue' },
 *   },
 *   fallback: { output: null },
 * })
 * const parallel = createParallel(executor)
 * await parallel({ id: 'review-parallel', context: { content: 'x' }, agents: { reviewer } })
 *
 * // Inspect exactly what the composition passed to the executor:
 * expect(executor.calls[0].options.input).toEqual({ content: 'x' })
 * expect(executor.calls[0].executionContext?.stepLabel).toBe('reviewer')
 * ```
 *
 * @module
 */

import type { AnyAgent } from './agent'
import type { AgentExecutor, AgentResult, ExecuteOptions } from './executor'
import type { AnyModel } from '../types'
import { getExecutionContext } from '../runtime/execution-context'
import type { ExecutionContext } from '../runtime/execution-context'

// ── Behavior config ────────────────────────────────────────────────

/** Token usage shape carried on an {@link AgentResult}. */
export type FakeAgentUsage = NonNullable<AgentResult['usage']>

/**
 * What the fake does for a single agent invocation.
 *
 * - `{ output }` — return text/object output (the common case).
 * - `{ transfer, reason }` — simulate the LLM calling the swarm's
 *   `transfer_to_<transfer>` tool, then return (used by `swarm()`). An
 *   optional `output` overrides the default `"Transferring to <transfer>"`.
 * - `{ throws }` — reject, to exercise a composition's error path.
 *
 * `usage` may be attached to any non-throwing behavior.
 */
export type FakeAgentBehavior =
  | { readonly output: unknown; readonly usage?: FakeAgentUsage }
  | {
      readonly transfer: string
      readonly reason: string
      readonly output?: unknown
      readonly usage?: FakeAgentUsage
    }
  | { readonly throws: Error | string }

/**
 * Resolve a behavior dynamically from the agent, the options it was called
 * with, and the zero-based global invocation index. Use this for
 * call-order-dependent fakes (e.g. consensus voters that all share one agent
 * id but should return different votes per call).
 */
export type FakeAgentBehaviorResolver = (
  agent: AnyAgent,
  options: ExecuteOptions,
  callIndex: number,
) => FakeAgentBehavior

/** Configuration for {@link createFakeAgentExecutor}. */
export interface FakeAgentExecutorConfig {
  /** Per-agent-id behavior (static or resolved per call). */
  readonly agents?: Readonly<Record<string, FakeAgentBehavior | FakeAgentBehaviorResolver>>
  /**
   * Behavior when no `agents` entry matches `agent.id`.
   *
   * - omitted — throw (the strict default; surfaces an unconfigured agent).
   * - `'echo'` — return `{ output: { _agent: agent.id, _input: options.input } }`.
   * - a behavior or resolver — same forms as a per-agent entry.
   */
  readonly fallback?: FakeAgentBehavior | FakeAgentBehaviorResolver | 'echo'
  /** `durationMs` reported on every result (>= 0). Default `10`. */
  readonly durationMs?: number
}

// ── Invocation record ──────────────────────────────────────────────

/** One recorded executor invocation, for asserting what a composition passed. */
export interface FakeAgentInvocation {
  /** The agent the composition asked to execute. */
  readonly agent: AnyAgent
  /** The full options the composition passed (input, model, tools, …). */
  readonly options: ExecuteOptions
  /** The model the executor would resolve: `agent.model ?? options.model`. */
  readonly resolvedModel: AnyModel | undefined
  /** The ambient execution context observed inside the executor body. */
  readonly executionContext: ExecutionContext | undefined
}

/** An {@link AgentExecutor} that records every invocation on `calls`. */
export interface FakeAgentExecutor extends AgentExecutor {
  /** Every invocation, in call order. */
  readonly calls: readonly FakeAgentInvocation[]
}

// ── Transfer tool shape (swarm handoff) ────────────────────────────

/** The minimal `transfer_to_<id>` tool shape the swarm executor invokes. */
interface TransferTool {
  execute: (args: { reason: string; context: string }) => Promise<unknown>
}

// ── Factory ────────────────────────────────────────────────────────

/**
 * Create a conformant in-memory {@link AgentExecutor} for composition tests.
 *
 * Resolves the model as `agent.model ?? options.model`, returns a well-formed
 * {@link AgentResult}, records each invocation on {@link FakeAgentExecutor.calls},
 * and runs its body inside the ambient execution context the composition
 * established — so `executionContext` on each call reflects the parent/child
 * threading `parallel()`/`pipeline()`/`swarm()` set up.
 *
 * @param config - Per-agent behaviors and fallback. Defaults to a strict fake
 *   that throws on any unconfigured agent.
 */
export function createFakeAgentExecutor(config: FakeAgentExecutorConfig = {}): FakeAgentExecutor {
  const calls: FakeAgentInvocation[] = []
  const durationMs = config.durationMs ?? 10

  const resolveBehavior = (agent: AnyAgent, options: ExecuteOptions, callIndex: number): FakeAgentBehavior => {
    const entry = config.agents?.[agent.id]
    if (entry !== undefined) return typeof entry === 'function' ? entry(agent, options, callIndex) : entry

    const fallback = config.fallback
    if (fallback === undefined) {
      throw new Error(`createFakeAgentExecutor: no behavior configured for agent "${agent.id}"`)
    }
    if (fallback === 'echo') return { output: { _agent: agent.id, _input: options.input } }
    return typeof fallback === 'function' ? fallback(agent, options, callIndex) : fallback
  }

  const executor = async (agent: AnyAgent, options: ExecuteOptions): Promise<AgentResult> => {
    const callIndex = calls.length
    const resolvedModel = (agent.model ?? options.model) as AnyModel | undefined
    calls.push({ agent, options, resolvedModel, executionContext: getExecutionContext() })

    const behavior = resolveBehavior(agent, options, callIndex)

    if ('throws' in behavior) {
      throw typeof behavior.throws === 'string' ? new Error(behavior.throws) : behavior.throws
    }

    if ('transfer' in behavior) {
      const toolName = `transfer_to_${behavior.transfer}`
      const tools = options.tools as Record<string, TransferTool> | undefined
      const transferTool = tools?.[toolName]
      if (!transferTool?.execute) {
        throw new Error(`Transfer tool "${toolName}" not found in options.tools`)
      }
      await transferTool.execute({ reason: behavior.reason, context: `Handing off from ${agent.id}` })
      return {
        agentId: agent.id,
        output: behavior.output ?? `Transferring to ${behavior.transfer}`,
        durationMs,
        ...(behavior.usage ? { usage: behavior.usage } : {}),
      }
    }

    return {
      agentId: agent.id,
      output: behavior.output,
      durationMs,
      ...(behavior.usage ? { usage: behavior.usage } : {}),
    }
  }

  return Object.assign(executor, { calls })
}
