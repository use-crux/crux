/**
 * Pipeline composition — chain agents sequentially with typed context accumulation.
 *
 * Each step's output is stored under its name in an accumulating context object.
 * Every step's `input` callback receives the full accumulated context (seed + all
 * previous outputs) with full TypeScript inference via function overloads.
 *
 * @module
 */

import { isAgent } from './agent'
import type { AnyAgent, InferAgentOutput } from './agent'
import type { AgentExecutor, AgentResult } from './executor'
import { getRuntime } from '../runtime/runtime'
import { runWithExecutionContext, getExecutionContext } from '../runtime/execution-context'
import { executeWithRetry } from '../generation/retry'
import type { RetryOptions } from '../generation/retry'
import { observe } from '../observability'

// ── Types ───────────────────────────────────────────────────────────

/** Extract step name from a step definition. */
export type StepName<S> = S extends { name: infer N extends string } ? N : never

/**
 * Extract the output type from a pipeline step.
 * - fn step: inferred from return type of `fn`
 * - agent step: inferred from agent's prompt output schema
 */
export type StepOutput<S> = S extends {
  fn: (ctx: infer _TCtx) => Promise<infer O>
}
  ? O
  : S extends { agent: infer A extends AnyAgent }
    ? InferAgentOutput<A>
    : unknown

/** The result of a completed pipeline execution. */
export interface PipelineResult<TContext = unknown> {
  status: 'completed'
  context: TContext
  finalOutput: unknown
  results: AgentResult[]
  durationMs: number
}

// ── Helpers ─────────────────────────────────────────────────────────

function generateCompositionId(): string {
  return `comp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** Runtime step type — the implementation works with this union. */
interface RuntimeStep {
  name: string
  agent?: AnyAgent
  fn?: (ctx: Record<string, unknown>) => Promise<unknown>
  input?: (ctx: Record<string, unknown>) => unknown
  retry?: RetryOptions
}

function isAgentStep(step: RuntimeStep): step is RuntimeStep & { agent: AnyAgent } {
  return step.agent != null && isAgent(step.agent)
}

function isFnStep(step: RuntimeStep): step is RuntimeStep & {
  fn: (ctx: Record<string, unknown>) => Promise<unknown>
} {
  return typeof step.fn === 'function'
}

// ── Factory ─────────────────────────────────────────────────────────

/**
 * Create a `pipeline()` function bound to an executor.
 *
 * @param executor - SDK-specific agent executor.
 * @returns A `pipeline()` function with typed context accumulation.
 */
export function createPipeline(executor: AgentExecutor) {
  /**
   * Chain agents sequentially with typed context accumulation.
   *
   * Each step's output is stored under its `name` key in the accumulating context.
   * The `input` callback receives the full accumulated context (seed + all prior outputs).
   *
   * @example
   * ```ts
   * const result = await pipeline({
   *   context: { userId, projectId },
   *   model,
   *   steps: [
   *     { name: 'research', agent: researcher },
   *     { name: 'write', agent: writer, input: (ctx) => ({ findings: ctx.research.synthesis }) },
   *     { name: 'format', fn: async (ctx) => ({ html: render(ctx.write.draft) }) },
   *   ],
   * })
   * result.context.research  // typed as researcher's output
   * result.context.write     // typed as writer's output
   * result.context.format    // typed as { html: string }
   * ```
   */
  // ── Accumulated context after N steps ─────────────────────────
  type Acc0<TCtx> = TCtx
  type Acc1<TCtx, S1> = TCtx & Record<StepName<S1>, StepOutput<S1>>
  type Acc2<TCtx, S1, S2> = Acc1<TCtx, S1> & Record<StepName<S2>, StepOutput<S2>>
  type Acc3<TCtx, S1, S2, S3> = Acc2<TCtx, S1, S2> & Record<StepName<S3>, StepOutput<S3>>
  type Acc4<TCtx, S1, S2, S3, S4> = Acc3<TCtx, S1, S2, S3> & Record<StepName<S4>, StepOutput<S4>>
  type Acc5<TCtx, S1, S2, S3, S4, S5> = Acc4<TCtx, S1, S2, S3, S4> & Record<StepName<S5>, StepOutput<S5>>
  type Acc6<TCtx, S1, S2, S3, S4, S5, S6> = Acc5<TCtx, S1, S2, S3, S4, S5> & Record<StepName<S6>, StepOutput<S6>>
  type Acc7<TCtx, S1, S2, S3, S4, S5, S6, S7> = Acc6<TCtx, S1, S2, S3, S4, S5, S6> &
    Record<StepName<S7>, StepOutput<S7>>
  type Acc8<TCtx, S1, S2, S3, S4, S5, S6, S7, S8> = Acc7<TCtx, S1, S2, S3, S4, S5, S6, S7> &
    Record<StepName<S8>, StepOutput<S8>>
  type Acc9<TCtx, S1, S2, S3, S4, S5, S6, S7, S8, S9> = Acc8<TCtx, S1, S2, S3, S4, S5, S6, S7, S8> &
    Record<StepName<S9>, StepOutput<S9>>
  type Acc10<TCtx, S1, S2, S3, S4, S5, S6, S7, S8, S9, S10> = Acc9<TCtx, S1, S2, S3, S4, S5, S6, S7, S8, S9> &
    Record<StepName<S10>, StepOutput<S10>>

  // ── Step shape at a given position ────────────────────────────
  // The fn/input callbacks receive the accumulated context at that position.
  // We use a mapped intersection to type the callbacks while keeping the
  // step generic unconstrained so StepOutput<S> can extract the concrete
  // fn return type (not widened to `unknown`).
  type StepAt<TCtx> = {
    name: string
    agent?: AnyAgent
    fn?: (ctx: TCtx) => Promise<unknown>
    input?: (ctx: TCtx) => unknown
    retry?: RetryOptions
  }

  // ── Overloads — one per step count, handles both agent + fn ──
  // Generic step params are unconstrained. The tuple position types
  // the fn/input parameter via intersection, preserving the concrete
  // return type for StepOutput extraction.

  // 1 step
  function pipeline<TCtx extends Record<string, unknown>, const S1 extends { name: string }>(options: {
    context: TCtx
    model?: unknown
    sessionId?: string
    validationRetry?: import('../generation/validation-retry').ValidationRetryOptions
    steps: [S1 & StepAt<Acc0<TCtx>>]
  }): Promise<PipelineResult<Acc1<TCtx, S1>>>

  // 2 steps
  function pipeline<
    TCtx extends Record<string, unknown>,
    const S1 extends { name: string },
    const S2 extends { name: string },
  >(options: {
    context: TCtx
    model?: unknown
    sessionId?: string
    validationRetry?: import('../generation/validation-retry').ValidationRetryOptions
    steps: [S1 & StepAt<Acc0<TCtx>>, S2 & StepAt<Acc1<TCtx, S1>>]
  }): Promise<PipelineResult<Acc2<TCtx, S1, S2>>>

  // 3 steps
  function pipeline<
    TCtx extends Record<string, unknown>,
    const S1 extends { name: string },
    const S2 extends { name: string },
    const S3 extends { name: string },
  >(options: {
    context: TCtx
    model?: unknown
    sessionId?: string
    validationRetry?: import('../generation/validation-retry').ValidationRetryOptions
    steps: [S1 & StepAt<Acc0<TCtx>>, S2 & StepAt<Acc1<TCtx, S1>>, S3 & StepAt<Acc2<TCtx, S1, S2>>]
  }): Promise<PipelineResult<Acc3<TCtx, S1, S2, S3>>>

  // 4 steps
  function pipeline<
    TCtx extends Record<string, unknown>,
    const S1 extends { name: string },
    const S2 extends { name: string },
    const S3 extends { name: string },
    const S4 extends { name: string },
  >(options: {
    context: TCtx
    model?: unknown
    sessionId?: string
    validationRetry?: import('../generation/validation-retry').ValidationRetryOptions
    steps: [
      S1 & StepAt<Acc0<TCtx>>,
      S2 & StepAt<Acc1<TCtx, S1>>,
      S3 & StepAt<Acc2<TCtx, S1, S2>>,
      S4 & StepAt<Acc3<TCtx, S1, S2, S3>>,
    ]
  }): Promise<PipelineResult<Acc4<TCtx, S1, S2, S3, S4>>>

  // 5 steps
  function pipeline<
    TCtx extends Record<string, unknown>,
    const S1 extends { name: string },
    const S2 extends { name: string },
    const S3 extends { name: string },
    const S4 extends { name: string },
    const S5 extends { name: string },
  >(options: {
    context: TCtx
    model?: unknown
    sessionId?: string
    validationRetry?: import('../generation/validation-retry').ValidationRetryOptions
    steps: [
      S1 & StepAt<Acc0<TCtx>>,
      S2 & StepAt<Acc1<TCtx, S1>>,
      S3 & StepAt<Acc2<TCtx, S1, S2>>,
      S4 & StepAt<Acc3<TCtx, S1, S2, S3>>,
      S5 & StepAt<Acc4<TCtx, S1, S2, S3, S4>>,
    ]
  }): Promise<PipelineResult<Acc5<TCtx, S1, S2, S3, S4, S5>>>

  // 6 steps
  function pipeline<
    TCtx extends Record<string, unknown>,
    const S1 extends { name: string },
    const S2 extends { name: string },
    const S3 extends { name: string },
    const S4 extends { name: string },
    const S5 extends { name: string },
    const S6 extends { name: string },
  >(options: {
    context: TCtx
    model?: unknown
    sessionId?: string
    validationRetry?: import('../generation/validation-retry').ValidationRetryOptions
    steps: [
      S1 & StepAt<Acc0<TCtx>>,
      S2 & StepAt<Acc1<TCtx, S1>>,
      S3 & StepAt<Acc2<TCtx, S1, S2>>,
      S4 & StepAt<Acc3<TCtx, S1, S2, S3>>,
      S5 & StepAt<Acc4<TCtx, S1, S2, S3, S4>>,
      S6 & StepAt<Acc5<TCtx, S1, S2, S3, S4, S5>>,
    ]
  }): Promise<PipelineResult<Acc6<TCtx, S1, S2, S3, S4, S5, S6>>>

  // 7 steps
  function pipeline<
    TCtx extends Record<string, unknown>,
    const S1 extends { name: string },
    const S2 extends { name: string },
    const S3 extends { name: string },
    const S4 extends { name: string },
    const S5 extends { name: string },
    const S6 extends { name: string },
    const S7 extends { name: string },
  >(options: {
    context: TCtx
    model?: unknown
    sessionId?: string
    validationRetry?: import('../generation/validation-retry').ValidationRetryOptions
    steps: [
      S1 & StepAt<Acc0<TCtx>>,
      S2 & StepAt<Acc1<TCtx, S1>>,
      S3 & StepAt<Acc2<TCtx, S1, S2>>,
      S4 & StepAt<Acc3<TCtx, S1, S2, S3>>,
      S5 & StepAt<Acc4<TCtx, S1, S2, S3, S4>>,
      S6 & StepAt<Acc5<TCtx, S1, S2, S3, S4, S5>>,
      S7 & StepAt<Acc6<TCtx, S1, S2, S3, S4, S5, S6>>,
    ]
  }): Promise<PipelineResult<Acc7<TCtx, S1, S2, S3, S4, S5, S6, S7>>>

  // 8 steps
  function pipeline<
    TCtx extends Record<string, unknown>,
    const S1 extends { name: string },
    const S2 extends { name: string },
    const S3 extends { name: string },
    const S4 extends { name: string },
    const S5 extends { name: string },
    const S6 extends { name: string },
    const S7 extends { name: string },
    const S8 extends { name: string },
  >(options: {
    context: TCtx
    model?: unknown
    sessionId?: string
    validationRetry?: import('../generation/validation-retry').ValidationRetryOptions
    steps: [
      S1 & StepAt<Acc0<TCtx>>,
      S2 & StepAt<Acc1<TCtx, S1>>,
      S3 & StepAt<Acc2<TCtx, S1, S2>>,
      S4 & StepAt<Acc3<TCtx, S1, S2, S3>>,
      S5 & StepAt<Acc4<TCtx, S1, S2, S3, S4>>,
      S6 & StepAt<Acc5<TCtx, S1, S2, S3, S4, S5>>,
      S7 & StepAt<Acc6<TCtx, S1, S2, S3, S4, S5, S6>>,
      S8 & StepAt<Acc7<TCtx, S1, S2, S3, S4, S5, S6, S7>>,
    ]
  }): Promise<PipelineResult<Acc8<TCtx, S1, S2, S3, S4, S5, S6, S7, S8>>>

  // 9 steps
  function pipeline<
    TCtx extends Record<string, unknown>,
    const S1 extends { name: string },
    const S2 extends { name: string },
    const S3 extends { name: string },
    const S4 extends { name: string },
    const S5 extends { name: string },
    const S6 extends { name: string },
    const S7 extends { name: string },
    const S8 extends { name: string },
    const S9 extends { name: string },
  >(options: {
    context: TCtx
    model?: unknown
    sessionId?: string
    validationRetry?: import('../generation/validation-retry').ValidationRetryOptions
    steps: [
      S1 & StepAt<Acc0<TCtx>>,
      S2 & StepAt<Acc1<TCtx, S1>>,
      S3 & StepAt<Acc2<TCtx, S1, S2>>,
      S4 & StepAt<Acc3<TCtx, S1, S2, S3>>,
      S5 & StepAt<Acc4<TCtx, S1, S2, S3, S4>>,
      S6 & StepAt<Acc5<TCtx, S1, S2, S3, S4, S5>>,
      S7 & StepAt<Acc6<TCtx, S1, S2, S3, S4, S5, S6>>,
      S8 & StepAt<Acc7<TCtx, S1, S2, S3, S4, S5, S6, S7>>,
      S9 & StepAt<Acc8<TCtx, S1, S2, S3, S4, S5, S6, S7, S8>>,
    ]
  }): Promise<PipelineResult<Acc9<TCtx, S1, S2, S3, S4, S5, S6, S7, S8, S9>>>

  // 10 steps
  function pipeline<
    TCtx extends Record<string, unknown>,
    const S1 extends { name: string },
    const S2 extends { name: string },
    const S3 extends { name: string },
    const S4 extends { name: string },
    const S5 extends { name: string },
    const S6 extends { name: string },
    const S7 extends { name: string },
    const S8 extends { name: string },
    const S9 extends { name: string },
    const S10 extends { name: string },
  >(options: {
    context: TCtx
    model?: unknown
    sessionId?: string
    validationRetry?: import('../generation/validation-retry').ValidationRetryOptions
    steps: [
      S1 & StepAt<Acc0<TCtx>>,
      S2 & StepAt<Acc1<TCtx, S1>>,
      S3 & StepAt<Acc2<TCtx, S1, S2>>,
      S4 & StepAt<Acc3<TCtx, S1, S2, S3>>,
      S5 & StepAt<Acc4<TCtx, S1, S2, S3, S4>>,
      S6 & StepAt<Acc5<TCtx, S1, S2, S3, S4, S5>>,
      S7 & StepAt<Acc6<TCtx, S1, S2, S3, S4, S5, S6>>,
      S8 & StepAt<Acc7<TCtx, S1, S2, S3, S4, S5, S6, S7>>,
      S9 & StepAt<Acc8<TCtx, S1, S2, S3, S4, S5, S6, S7, S8>>,
      S10 & StepAt<Acc9<TCtx, S1, S2, S3, S4, S5, S6, S7, S8, S9>>,
    ]
  }): Promise<PipelineResult<Acc10<TCtx, S1, S2, S3, S4, S5, S6, S7, S8, S9, S10>>>

  // Fallback: 11+ steps
  function pipeline(options: {
    context: Record<string, unknown>
    model?: unknown
    sessionId?: string
    validationRetry?: import('../generation/validation-retry').ValidationRetryOptions
    steps: StepAt<Record<string, unknown>>[]
  }): Promise<PipelineResult<Record<string, unknown>>>

  // ── Implementation (must immediately follow overloads) ────────

  async function pipeline(options: {
    context: Record<string, unknown>
    model?: unknown
    steps: RuntimeStep[]
    sessionId?: string
    validationRetry?: import('../generation/validation-retry').ValidationRetryOptions
  }): Promise<PipelineResult<Record<string, unknown>>> {
    const { context, model, steps, sessionId, validationRetry } = options
    const runtime = getRuntime()

    const compositionId = generateCompositionId()
    const pipelineStart = Date.now()
    const results: AgentResult[] = []
    const agentIds = steps.map((s) => (s.agent && isAgent(s.agent) ? s.agent.id : s.name))

    return observe.span(
      {
        name: 'pipeline',
        family: 'composition',
        primitive: 'composition.pipeline',
        attributes: { compositionId, agentIds },
      },
      async () => {
        // Start with seed context
        let accumulatedContext: Record<string, unknown> = { ...context }

        // Emit composition:start
        runtime.instrumentationHooks?.onCompositionStart?.({
          compositionId,
          kind: 'pipeline',
          agentIds,
        })

        for (let i = 0; i < steps.length; i++) {
          const step = steps[i]

          // Determine step input: callback(ctx) or accumulated context
          const stepInput = step.input ? step.input(accumulatedContext) : accumulatedContext

          const stepStart = Date.now()
          const parentCtx = getExecutionContext()
          const stepCtx = {
            ...parentCtx,
            stepId: `${compositionId}-${step.name}-${i}`,
            stepLabel: step.name,
            ...(sessionId ? { sessionId } : {}),
          }

          const stepSpan = observe.openSpan({
            name: step.name,
            family: 'flow',
            primitive: 'flow.step',
            attributes: {
              compositionId,
              stepId: `${compositionId}-${step.name}-${i}`,
              stepLabel: step.name,
              index: i,
              kind: isFnStep(step) ? 'function' : 'agent',
            },
          })
          try {
            let result: AgentResult

            result = await stepSpan.withContext(async () => {
              if (isFnStep(step)) {
                // Plain function step
                const output = await runWithExecutionContext(stepCtx, () =>
                  executeWithRetry(() => step.fn(accumulatedContext), step.retry),
                )
                return {
                  agentId: step.name,
                  output,
                  durationMs: Date.now() - stepStart,
                }
              }
              if (isAgentStep(step)) {
                // Agent step
                return await observe.span(
                  {
                    name: step.agent.id,
                    family: 'agent',
                    primitive: 'agent.run',
                    attributes: {
                      compositionId,
                      agentId: step.agent.id,
                      stepId: `${compositionId}-${step.name}-${i}`,
                      stepLabel: step.name,
                      index: i,
                    },
                  },
                  () =>
                    runWithExecutionContext(stepCtx, () =>
                      executeWithRetry(
                        () => executor(step.agent, { input: stepInput, model, validationRetry }),
                        step.retry,
                      ),
                    ),
                )
              }
              throw new Error(`Pipeline step "${step.name}" has neither 'agent' nor 'fn'`)
            })

            results.push(result)

            // Capture .created values from agent creation tools
            let stepOutput = result.output
            if (isAgentStep(step) && step.agent.tools) {
              const created: Record<string, unknown> = {}
              for (const [toolName, tool] of Object.entries(step.agent.tools)) {
                if (tool && typeof tool === 'object' && 'created' in tool) {
                  const value = (tool as { created?: unknown }).created
                  if (value !== undefined) created[toolName] = value
                }
              }
              if (Object.keys(created).length > 0) {
                stepOutput =
                  typeof result.output === 'object' && result.output !== null
                    ? { ...result.output, _created: created }
                    : { _value: result.output, _created: created }
              }
            }

            // Accumulate: store step output under its name
            accumulatedContext = { ...accumulatedContext, [step.name]: stepOutput }

            // Emit composition:agent (success)
            runtime.instrumentationHooks?.onCompositionAgent?.({
              compositionId,
              agentId: result.agentId,
              index: i,
              status: 'success',
              durationMs: result.durationMs,
            })
            stepSpan.end({ agentId: result.agentId })
          } catch (err) {
            stepSpan.error(err)
            const agentId = isAgentStep(step) ? step.agent.id : step.name
            const message = err instanceof Error ? err.message : String(err)

            // Emit composition:agent (error)
            runtime.instrumentationHooks?.onCompositionAgent?.({
              compositionId,
              agentId,
              index: i,
              status: 'error',
              durationMs: Date.now() - stepStart,
              error: message,
            })
            // Emit composition:end (error)
            runtime.instrumentationHooks?.onCompositionEnd?.({
              compositionId,
              kind: 'pipeline',
              status: 'error',
              durationMs: Date.now() - pipelineStart,
              agentCount: steps.length,
            })
            throw new Error(`Pipeline step "${step.name}" failed: ${message}`)
          }
        }

        const durationMs = Date.now() - pipelineStart

        // Emit composition:end (success)
        runtime.instrumentationHooks?.onCompositionEnd?.({
          compositionId,
          kind: 'pipeline',
          status: 'success',
          durationMs,
          agentCount: steps.length,
        })
        emitPipelineCompositionReport({
          compositionId,
          durationMs,
          stages: steps.map((step, index) => ({
            name: step.name,
            status: 'success',
            outputPreview: results[index]?.output,
          })),
        })

        return {
          status: 'completed',
          context: accumulatedContext,
          finalOutput: results.length > 0 ? results[results.length - 1].output : undefined,
          results,
          durationMs,
        }
      },
    )
  }

  return pipeline
}

function emitPipelineCompositionReport(args: {
  compositionId: string
  durationMs: number
  stages: readonly Record<string, unknown>[]
}): void {
  const spanId = observe.captureContext()?.currentSpanId
  if (!spanId) return
  const artifactId = observe.artifact({
    kind: 'composition.report',
    contentType: 'application/json',
    encoding: 'json',
    preview: {
      kind: 'composition.report',
      compositionType: 'pipeline',
      compositionId: args.compositionId,
      status: 'success',
      wallTimeMs: args.durationMs,
      stages: args.stages,
    },
    attributes: {
      primitive: 'composition.pipeline',
      compositionId: args.compositionId,
      stageCount: args.stages.length,
    },
  })
  if (!artifactId) return
  observe.edge({
    edgeType: 'produced',
    from: { kind: 'span', id: spanId },
    to: { kind: 'artifact', id: artifactId },
    attributes: { primitive: 'composition.pipeline', compositionId: args.compositionId },
  })
}
