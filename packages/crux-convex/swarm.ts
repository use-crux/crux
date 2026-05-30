/**
 * Convex swarm integration — run swarm-style agent routing across
 * Convex action boundaries with persistent state.
 *
 * Each agent turn runs in a separate action. After a handoff, the current
 * action schedules the next agent's turn via `ctx.scheduler.runAfter()`.
 * Swarm state is stored in a Convex table so the next action can resume.
 *
 * @module
 */

import { createFlowId, getExecutionContext, getRuntime } from '@crux/core'
import type { CruxRuntime } from '@crux/core'
import type { AnyAgent } from '@crux/core/agent'
import { observe, type CapturedObservabilityContext } from '@crux/core/observability'
import type { ComponentApi } from './src/component/_generated/component'
import { flushObservability } from './observability'

// ── Types ───────────────────────────────────────────────────────────

/**
 * Serialized swarm state stored in Convex.
 *
 * @experimental Durable cross-action swarm state is exploratory and may change
 * before the first stable Crux Convex swarm API.
 */
export interface ConvexSwarmState {
  /** Unique identifier for this swarm run. */
  swarmRunId: string
  /** ID of the agent currently executing. */
  currentAgentId: string
  /** Full handoff path so far. */
  handoffPath: string[]
  /** Number of handoffs completed. */
  handoffCount: number
  /** Input for the current agent. */
  currentInput: unknown
  /** Original input to the swarm. */
  originalInput: unknown
  /** Swarm status. */
  status: 'running' | 'completed' | 'error'
  /** Final output (set when completed). */
  output?: unknown
  /** Error message (set when errored). */
  error?: string
  /** Flow ID for devtools trace correlation. */
  flowId: string
  /** Session ID for grouping related runs. */
  sessionId?: string
  /** Canonical observability context to restore after Convex scheduler hops. */
  observability?: CapturedObservabilityContext
  /** Maximum handoffs allowed. */
  maxHandoffs: number
  /** History mode. */
  history: 'transfer-only' | 'accumulate'
  /** Timestamp of creation. */
  createdAt: number
  /** Timestamp of last update. */
  updatedAt: number
}

/** Options for starting a Convex swarm. */
export interface ConvexSwarmStartOptions {
  /** Named map of agent IDs to agent definitions. */
  agents: Record<string, AnyAgent>
  /** ID of the agent that starts the swarm. */
  startAgent: string
  /** Input data for the first agent. */
  input: unknown
  /** Maximum handoffs before aborting. @default 10 */
  maxHandoffs?: number
  /** History mode. @default 'transfer-only' */
  history?: 'transfer-only' | 'accumulate'
  /** Session ID for grouping in devtools. */
  sessionId?: string
}

/** Result of a single swarm turn (one agent execution). */
export interface ConvexSwarmTurnResult {
  /** Whether this turn resulted in a handoff to another agent. */
  handedOff: boolean
  /** The agent that just executed. */
  agentId: string
  /** The agent's output. */
  output: unknown
  /** The target agent if handoff occurred. */
  handoffTarget?: string
  /** The reason for handoff. */
  handoffReason?: string
  /** Updated swarm state. */
  state: ConvexSwarmState
}

/**
 * Context required for component-based swarm operations.
 *
 * Matches Convex's `ActionCtx` shape. Uses `FunctionReference` generics
 * where possible, but component cross-boundary calls require `unknown`
 * for function refs since the exact types come from the host app's codegen.
 */
/**
 * Context required for component-based swarm operations.
 *
 * Compatible with Convex's `ActionCtx` — uses generic function signatures
 * that accept Convex's typed FunctionReferences without requiring the
 * exact generic parameters.
 */
export interface SwarmActionCtx {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  runMutation: (ref: any, ...args: any[]) => Promise<any>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  runQuery: (ref: any, ...args: any[]) => Promise<any>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  scheduler: {
    runAfter: (delayMs: number, ref: any, ...args: any[]) => Promise<any>
  }
}

/**
 * Convex table schema fields for cruxSwarmRuns.
 *
 * @experimental Durable cross-action swarm state is exploratory and may change
 * before the first stable Crux Convex swarm API.
 */
export const swarmRunFields = {
  swarmRunId: 'string' as const,
  currentAgentId: 'string' as const,
  handoffPath: 'any' as const,
  handoffCount: 'number' as const,
  currentInput: 'any' as const,
  originalInput: 'any' as const,
  status: 'string' as const,
  output: 'any' as const,
  error: 'string' as const,
  flowId: 'string' as const,
  sessionId: 'string' as const,
  maxHandoffs: 'number' as const,
  history: 'string' as const,
  createdAt: 'number' as const,
  updatedAt: 'number' as const,
}

// ── Helpers ─────────────────────────────────────────────────────────

function generateSwarmRunId(): string {
  return `swarm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function captureBaseObservabilityContext(): CapturedObservabilityContext | undefined {
  const captured = observe.captureContext()
  if (!captured) return undefined
  return {
    runId: captured.runId,
    traceId: captured.traceId,
    spanStack: [],
  }
}

/** Build transfer-only input for next agent. */
function buildTransferOnlyInput(
  originalInput: unknown,
  fromAgent: string,
  toAgent: string,
  reason: string,
  context: string,
): unknown {
  const base =
    typeof originalInput === 'object' && originalInput !== null
      ? { ...(originalInput as Record<string, unknown>) }
      : { _originalInput: originalInput }
  return {
    ...base,
    _handoff: { fromAgent, toAgent, reason, context },
  }
}

/** Build accumulated input for next agent. */
function buildAccumulateInput(
  originalInput: unknown,
  previousOutput: unknown,
  handoffPath: string[],
  fromAgent: string,
  toAgent: string,
  reason: string,
  context: string,
): unknown {
  const base =
    typeof originalInput === 'object' && originalInput !== null
      ? { ...(originalInput as Record<string, unknown>) }
      : { _originalInput: originalInput }
  return {
    ...base,
    _previousOutput: previousOutput,
    _handoffPath: handoffPath,
    _handoff: { fromAgent, toAgent, reason, context },
  }
}

// ── Factory ─────────────────────────────────────────────────────────

/**
 * Create a Convex-compatible swarm runner.
 *
 * @experimental This low-level helper is an exploratory durable swarm
 * building block. Prefer the immediate adapter `swarm()`/`swarm()` style for
 * launch-critical flows, or use Convex `flow()` for durable orchestration.
 *
 * Unlike `swarm()` from `@crux/core/agent` which runs the entire loop
 * in a single function call, the Convex swarm runner executes **one agent
 * turn per action**. After a handoff, the caller schedules the next turn
 * via `ctx.scheduler.runAfter()`.
 *
 * @param executeTurn - Function that executes a single agent turn.
 *   Receives the agent and input, returns the output and whether a
 *   handoff tool was called (with target/reason/context).
 *
 * @returns Object with `start`, `resume`, and `createInitialState` methods.
 *
 * @example
 * ```ts
 * // In your Convex action:
 * import { createConvexSwarm } from '@crux/convex/swarm'
 *
 * const swarm = createConvexSwarm(async (agent, input, agents) => {
 *   // Execute the agent using your SDK adapter
 *   const result = await runAgentTurn(agent, input, agents)
 *   return result
 * })
 *
 * // Start a swarm
 * export const startSwarm = action(async (ctx, args) => {
 *   const state = swarm.createInitialState({
 *     agents: { triage, billing, refunds },
 *     startAgent: 'triage',
 *     input: { message: args.message },
 *   })
 *   await ctx.runMutation(saveSwarmState, state)
 *   const turn = await swarm.executeTurn(state, agents)
 *   await ctx.runMutation(updateSwarmState, turn.state)
 *   if (turn.handedOff) {
 *     await ctx.scheduler.runAfter(0, resumeSwarm, { swarmRunId: state.swarmRunId })
 *   }
 * })
 * ```
 */
export function createConvexSwarm(
  executeTurn: (
    agent: AnyAgent,
    input: unknown,
    agents: Record<string, AnyAgent>,
  ) => Promise<{
    output: unknown
    handoff?: { target: string; reason: string; context: string }
  }>,
) {
  return {
    /**
     * Create the initial swarm state without executing anything.
     * Save this to your Convex table, then call `runTurn()`.
     */
    createInitialState(options: ConvexSwarmStartOptions): ConvexSwarmState {
      const traceCtx = getExecutionContext()
      return {
        swarmRunId: generateSwarmRunId(),
        currentAgentId: options.startAgent,
        handoffPath: [options.startAgent],
        handoffCount: 0,
        currentInput: options.input,
        originalInput: options.input,
        status: 'running',
        flowId: traceCtx?.flowId ?? createFlowId(),
        sessionId: options.sessionId ?? traceCtx?.sessionId,
        observability: captureBaseObservabilityContext(),
        maxHandoffs: options.maxHandoffs ?? 10,
        history: options.history ?? 'transfer-only',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
    },

    /**
     * Execute one turn of the swarm (one agent execution).
     *
     * Returns the updated state. If `handedOff` is true, the caller
     * should schedule the next turn via `ctx.scheduler.runAfter()`.
     *
     * @param state - Current swarm state (from table).
     * @param agents - All agents in the swarm (reconstructed in each action).
     */
    async runTurn(state: ConvexSwarmState, agents: Record<string, AnyAgent>): Promise<ConvexSwarmTurnResult> {
      const agent = agents[state.currentAgentId]
      if (!agent) {
        const errorState: ConvexSwarmState = {
          ...state,
          status: 'error',
          error: `Agent "${state.currentAgentId}" not found in agents map`,
          updatedAt: Date.now(),
        }
        return {
          handedOff: false,
          agentId: state.currentAgentId,
          output: null,
          state: errorState,
        }
      }

      // Execute the agent
      const turnResult = await executeTurn(agent, state.currentInput, agents)

      // No handoff — swarm complete
      if (!turnResult.handoff) {
        const completedState: ConvexSwarmState = {
          ...state,
          status: 'completed',
          output: turnResult.output,
          updatedAt: Date.now(),
        }
        return {
          handedOff: false,
          agentId: state.currentAgentId,
          output: turnResult.output,
          state: completedState,
        }
      }

      // Handoff occurred
      const newHandoffCount = state.handoffCount + 1
      const handoff = turnResult.handoff

      // Check maxHandoffs
      if (newHandoffCount >= state.maxHandoffs) {
        const errorState: ConvexSwarmState = {
          ...state,
          status: 'error',
          handoffCount: newHandoffCount,
          handoffPath: [...state.handoffPath, handoff.target],
          error: `maxHandoffs (${state.maxHandoffs}) reached. Path: ${[...state.handoffPath, handoff.target].join(' → ')}`,
          updatedAt: Date.now(),
        }
        return {
          handedOff: false,
          agentId: state.currentAgentId,
          output: turnResult.output,
          handoffTarget: handoff.target,
          handoffReason: handoff.reason,
          state: errorState,
        }
      }

      // Build next input based on history mode
      const newHandoffPath = [...state.handoffPath, handoff.target]
      let nextInput: unknown
      if (state.history === 'accumulate') {
        nextInput = buildAccumulateInput(
          state.originalInput,
          turnResult.output,
          newHandoffPath,
          state.currentAgentId,
          handoff.target,
          handoff.reason,
          handoff.context,
        )
      } else {
        nextInput = buildTransferOnlyInput(
          state.originalInput,
          state.currentAgentId,
          handoff.target,
          handoff.reason,
          handoff.context,
        )
      }

      const updatedState: ConvexSwarmState = {
        ...state,
        currentAgentId: handoff.target,
        handoffPath: newHandoffPath,
        handoffCount: newHandoffCount,
        currentInput: nextInput,
        updatedAt: Date.now(),
      }

      return {
        handedOff: true,
        agentId: state.currentAgentId,
        output: turnResult.output,
        handoffTarget: handoff.target,
        handoffReason: handoff.reason,
        state: updatedState,
      }
    },
  }
}

// ── Component-based swarm ───────────────────────────────────────

import { buildTransferTools } from '@crux/core/agent'
import type { AnyPrompt } from '@crux/core'

/** A generate function that the component swarm can call. */
export type SwarmGenerateFn = (
  prompt: AnyPrompt,
  options: { input: unknown; tools?: Record<string, unknown> },
) => Promise<{ text?: string; object?: unknown }>

/** Options for creating a component-based swarm. */
export interface ComponentSwarmConfig {
  /** The crux component ref from `components.crux`. */
  component: ComponentApi
  /** Your generate function (from your SDK adapter). */
  generate: SwarmGenerateFn
}

/** Options for starting a component swarm run. */
export interface ComponentSwarmStartOptions {
  /** All agents in the swarm. Keys must match agent IDs. */
  agents: Record<string, AnyAgent>
  /** ID of the agent that starts. */
  startAgent: string
  /** Input for the first agent. */
  input: unknown
  /** Action reference for the resume action (for auto-scheduling). */
  resumeAction: unknown
  /** Maximum handoffs. @default 10 */
  maxHandoffs?: number
  /** History mode. @default 'transfer-only' */
  history?: 'transfer-only' | 'accumulate'
  /** Session ID for devtools grouping. */
  sessionId?: string
}

/**
 * Create a component-based Convex swarm.
 *
 * @experimental This API is an exploratory durable swarm helper, not the final
 * Crux Convex swarm contract. It persists one turn per scheduled action and is
 * useful for experimentation, but the stable launch model is that compositions
 * execute immediately and durable orchestration goes through `flow()`.
 *
 * Works like `swarm()` but across Convex action boundaries. You provide
 * your `generate` function — the swarm handles transfer tools, handoff
 * detection, state persistence, and action scheduling.
 *
 * @param config - Component ref and generate function.
 * @returns Object with `start`, `resume`, `getState`, and `listRuns` methods.
 *
 * @example
 * ```ts
 * import { createComponentSwarm } from '@crux/convex/swarm'
 * import { generate } from '@crux/ai'
 * import { components, internal } from './_generated/api'
 *
 * const swarm = createComponentSwarm({
 *   component: components.crux,
 *   generate: (prompt, opts) => generate(prompt, { ...opts, model }),
 * })
 *
 * // Start a swarm
 * export const start = action({
 *   args: { message: v.string() },
 *   handler: async (ctx, args) => {
 *     return swarm.start(ctx, {
 *       agents: { triage, billing, refunds },
 *       startAgent: 'triage',
 *       input: { message: args.message },
 *       resumeAction: internal.swarm.resume,
 *     })
 *   },
 * })
 *
 * // Resume (scheduled automatically on handoff)
 * export const resume = internalAction({
 *   args: { swarmRunId: v.string() },
 *   handler: (ctx, { swarmRunId }) =>
 *     swarm.resume(ctx, swarmRunId, {
 *       agents: { triage, billing, refunds },
 *       resumeAction: internal.swarm.resume,
 *     }),
 * })
 * ```
 */
export function createComponentSwarm(config: ComponentSwarmConfig) {
  const { component, generate } = config

  /** Execute one agent turn: inject transfer tools, call generate, detect handoff. */
  async function executeTurn(
    agent: AnyAgent,
    input: unknown,
    agents: Record<string, AnyAgent>,
  ): Promise<{
    output: unknown
    handoff: { target: string; reason: string; context: string } | null
  }> {
    // Build transfer tools (same as swarm in @crux/core)
    let pendingHandoff: {
      target: string
      reason: string
      context: string
    } | null = null
    const transferTools = buildTransferTools(agent, agents, (target, reason, context) => {
      pendingHandoff = { target, reason, context }
    })

    // Merge agent tools + transfer tools
    const mergedTools = {
      ...((agent.tools as Record<string, unknown>) ?? {}),
      ...transferTools,
    }

    // Call the user's generate function
    const result = await generate(agent.prompt, { input, tools: mergedTools })

    return {
      output: result.object ?? result.text,
      handoff: pendingHandoff,
    }
  }

  // Create the inner callback-based swarm for state management
  const inner = createConvexSwarm(async (agent, input, agents) => {
    const { output, handoff } = await executeTurn(agent, input, agents)
    return { output, ...(handoff ? { handoff } : {}) }
  })

  return {
    /**
     * Start a new swarm run. Creates state, executes the first agent turn,
     * persists state, and schedules the next turn if a handoff occurred.
     */
    async start(ctx: SwarmActionCtx, options: ComponentSwarmStartOptions) {
      try {
        const existingContext = observe.captureContext()
        const openedRun = existingContext
          ? undefined
          : observe.openRun({
              name: `swarm ${options.startAgent}`,
              rootPrimitive: 'composition.swarm',
              attributes: { 'swarm.start_agent': options.startAgent },
            })

        const execute = async () => {
          return await observe.span(
            {
              name: `swarm ${options.startAgent}`,
              family: 'composition',
              primitive: 'composition.swarm',
              attributes: { 'swarm.start_agent': options.startAgent },
            },
            async () => {
              const state = inner.createInitialState(options)
              const runtime: SwarmRuntime = getRuntime()
              const agentIds = Object.keys(options.agents)

              // Keep the base run context for scheduled resumes instead of
              // the short-lived turn span, so resumed turns remain siblings.
              state.observability = openedRun?.captureContext() ?? captureBaseObservabilityContext()

              // Emit composition:start
              runtime.instrumentationHooks?.onCompositionStart?.({
                compositionId: state.swarmRunId,
                kind: 'swarm',
                agentIds,
                startAgent: options.startAgent,
                maxHandoffs: options.maxHandoffs ?? 10,
              })

              // Persist initial state
              await ctx.runMutation(component.swarm.saveState, toSaveArgs(state))

              // Execute first turn
              const agentStart = Date.now()
              const turn = await inner.runTurn(state, options.agents as Record<string, AnyAgent>)

              // Emit composition:agent
              emitAgentEvent(runtime, state.swarmRunId, state.currentAgentId, 0, Date.now() - agentStart)

              // Persist updated state
              await ctx.runMutation(component.swarm.saveState, toSaveArgs(turn.state))

              // If completed (no handoff), emit composition:end
              if (!turn.handedOff) {
                emitEndEvent(runtime, state.swarmRunId, turn.state, Date.now() - agentStart)
                openedRun?.end({ status: turn.state.status === 'error' ? 'error' : 'ok' })
              }

              // Schedule next turn if handoff occurred
              if (turn.handedOff) {
                await ctx.scheduler.runAfter(0, options.resumeAction, {
                  swarmRunId: state.swarmRunId,
                })
              }

              return { swarmRunId: state.swarmRunId, state: turn.state }
            },
          )
        }

        try {
          return await (openedRun ? openedRun.withContext(execute) : execute())
        } catch (error) {
          openedRun?.error(error)
          throw error
        }
      } finally {
        await flushObservability()
      }
    },

    /**
     * Resume a swarm run. Loads state, executes one agent turn,
     * persists, and schedules the next turn if handoff.
     */
    async resume(
      ctx: SwarmActionCtx,
      swarmRunId: string,
      options: {
        agents: Record<string, AnyAgent>
        resumeAction: unknown
      },
    ) {
      let state: ConvexSwarmState | null = null
      try {
        state = await ctx.runQuery(component.swarm.getState, {
          swarmRunId,
        })
        if (!state || state.status !== 'running') return null
        const activeState = state

        return await observe.withContext(activeState.observability, async () => {
          const runtime: SwarmRuntime = getRuntime()
          const agentStart = Date.now()
          const turn = await observe.span(
            {
              name: `swarm ${activeState.currentAgentId}`,
              family: 'composition',
              primitive: 'composition.swarm',
              attributes: {
                'swarm.run_id': swarmRunId,
                'swarm.agent_id': activeState.currentAgentId,
                'swarm.hop': activeState.handoffCount,
              },
            },
            () => inner.runTurn(activeState, options.agents as Record<string, AnyAgent>),
          )

          // Emit composition:agent
          emitAgentEvent(
            runtime,
            swarmRunId,
            activeState.currentAgentId,
            activeState.handoffCount,
            Date.now() - agentStart,
            activeState.handoffCount > 0 ? activeState.handoffPath[activeState.handoffPath.length - 2] : undefined,
          )

          await ctx.runMutation(component.swarm.saveState, toSaveArgs(turn.state))

          // If completed or errored, emit composition:end
          if (!turn.handedOff) {
            emitEndEvent(runtime, swarmRunId, turn.state, Date.now() - agentStart)
            if (activeState.observability) {
              observe.endRun(activeState.observability, { status: turn.state.status === 'error' ? 'error' : 'ok' })
            }
          }

          if (turn.handedOff) {
            await ctx.scheduler.runAfter(0, options.resumeAction, { swarmRunId })
          }

          return turn.state
        })
      } catch (error) {
        if (state?.observability) {
          observe.endRun(state.observability, { status: 'error', error })
        }
        throw error
      } finally {
        await flushObservability()
      }
    },

    /** Get the current state of a swarm run. */
    async getState(ctx: SwarmActionCtx, swarmRunId: string) {
      return ctx.runQuery(component.swarm.getState, { swarmRunId })
    },

    /** List swarm runs, optionally filtered by status. */
    async listRuns(ctx: SwarmActionCtx, options?: { status?: 'running' | 'completed' | 'error'; limit?: number }) {
      return ctx.runQuery(component.swarm.listRuns, options ?? {})
    },
  }
}

/** Strip createdAt/updatedAt — managed by the component mutation. */
function toSaveArgs(state: ConvexSwarmState): Omit<ConvexSwarmState, 'createdAt' | 'updatedAt'> {
  const { createdAt, updatedAt, ...args } = state
  return args
}

// ── Instrumentation helpers ─────────────────────────────────────

/** Subset of CruxRuntime used for swarm instrumentation. */
type SwarmRuntime = Pick<CruxRuntime, 'instrumentationHooks'>

function emitAgentEvent(
  runtime: SwarmRuntime,
  compositionId: string,
  agentId: string,
  index: number,
  durationMs: number,
  handoffFrom?: string,
) {
  runtime.instrumentationHooks?.onCompositionAgent?.({
    compositionId,
    agentId,
    index,
    status: 'success',
    durationMs,
    ...(handoffFrom ? { handoffFrom } : {}),
    ...(index > 0 ? { hopNumber: index } : {}),
  })
}

function emitEndEvent(runtime: SwarmRuntime, compositionId: string, state: ConvexSwarmState, durationMs: number) {
  runtime.instrumentationHooks?.onCompositionEnd?.({
    compositionId,
    kind: 'swarm',
    status: state.status === 'error' ? 'error' : 'success',
    durationMs,
    agentCount: state.handoffPath.length,
    handoffPath: state.handoffPath,
    handoffCount: state.handoffCount,
    finalAgentId: state.currentAgentId,
  })
}
