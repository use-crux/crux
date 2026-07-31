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
import { createCompositionRuntime } from './composition-runtime'
import type { RetryOptions } from '../generation/retry'
import type { OperationResultMeta } from '../observability'
import { isCreationToolNotCreatedError } from '../types/tool'
import type {
  PipelineInvocationContext,
  PrepareInvocation,
} from '../request/prepare/invocation'
import type { CompositionRequestReceiptTree } from '../request/receipt/tree'
import { PreparationError } from '../request/prepare/step'
import { ResourceReadError } from '../request/prepare/resources'

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
  /** Exact `composition.pipeline` span that produced this parent envelope. */
  readonly _meta: OperationResultMeta
  status: 'completed'
  context: TContext
  finalOutput: unknown
  results: AgentResult[]
  durationMs: number
  /** Linked provider-request evidence for managed stages. */
  requestReceipts: CompositionRequestReceiptTree
}

/** Runtime step type — the implementation works with this union. */
interface RuntimeStep {
  name: string
  agent?: AnyAgent
  fn?: (ctx: Record<string, unknown>) => Promise<unknown>
  input?: (ctx: Record<string, unknown>) => unknown
  retry?: RetryOptions
}

/** Composition-boundary preparation accepted by `pipeline()` definitions. */
export interface PipelinePreparationOptions {
  prepareInvocation?: PrepareInvocation<unknown, PipelineInvocationContext>
}

function isAgentStep(
  step: RuntimeStep,
): step is RuntimeStep & { agent: AnyAgent } {
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
  type Acc2<TCtx, S1, S2> = Acc1<TCtx, S1> &
    Record<StepName<S2>, StepOutput<S2>>
  type Acc3<TCtx, S1, S2, S3> = Acc2<TCtx, S1, S2> &
    Record<StepName<S3>, StepOutput<S3>>
  type Acc4<TCtx, S1, S2, S3, S4> = Acc3<TCtx, S1, S2, S3> &
    Record<StepName<S4>, StepOutput<S4>>
  type Acc5<TCtx, S1, S2, S3, S4, S5> = Acc4<TCtx, S1, S2, S3, S4> &
    Record<StepName<S5>, StepOutput<S5>>
  type Acc6<TCtx, S1, S2, S3, S4, S5, S6> = Acc5<TCtx, S1, S2, S3, S4, S5> &
    Record<StepName<S6>, StepOutput<S6>>
  type Acc7<TCtx, S1, S2, S3, S4, S5, S6, S7> = Acc6<
    TCtx,
    S1,
    S2,
    S3,
    S4,
    S5,
    S6
  > &
    Record<StepName<S7>, StepOutput<S7>>
  type Acc8<TCtx, S1, S2, S3, S4, S5, S6, S7, S8> = Acc7<
    TCtx,
    S1,
    S2,
    S3,
    S4,
    S5,
    S6,
    S7
  > &
    Record<StepName<S8>, StepOutput<S8>>
  type Acc9<TCtx, S1, S2, S3, S4, S5, S6, S7, S8, S9> = Acc8<
    TCtx,
    S1,
    S2,
    S3,
    S4,
    S5,
    S6,
    S7,
    S8
  > &
    Record<StepName<S9>, StepOutput<S9>>
  type Acc10<TCtx, S1, S2, S3, S4, S5, S6, S7, S8, S9, S10> = Acc9<
    TCtx,
    S1,
    S2,
    S3,
    S4,
    S5,
    S6,
    S7,
    S8,
    S9
  > &
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
  function pipeline<
    TCtx extends Record<string, unknown>,
    const S1 extends { name: string },
  >(options: PipelinePreparationOptions & {
    /**
     * Stable author-supplied definition id, used to join this composition
     * with its Project Index definition and observability evidence. Distinct
     * from the random per-execution composition id.
     */
    id: string
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
  >(options: PipelinePreparationOptions & {
    /**
     * Stable author-supplied definition id, used to join this composition
     * with its Project Index definition and observability evidence. Distinct
     * from the random per-execution composition id.
     */
    id: string
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
  >(options: PipelinePreparationOptions & {
    /**
     * Stable author-supplied definition id, used to join this composition
     * with its Project Index definition and observability evidence. Distinct
     * from the random per-execution composition id.
     */
    id: string
    context: TCtx
    model?: unknown
    sessionId?: string
    validationRetry?: import('../generation/validation-retry').ValidationRetryOptions
    steps: [
      S1 & StepAt<Acc0<TCtx>>,
      S2 & StepAt<Acc1<TCtx, S1>>,
      S3 & StepAt<Acc2<TCtx, S1, S2>>,
    ]
  }): Promise<PipelineResult<Acc3<TCtx, S1, S2, S3>>>

  // 4 steps
  function pipeline<
    TCtx extends Record<string, unknown>,
    const S1 extends { name: string },
    const S2 extends { name: string },
    const S3 extends { name: string },
    const S4 extends { name: string },
  >(options: PipelinePreparationOptions & {
    /**
     * Stable author-supplied definition id, used to join this composition
     * with its Project Index definition and observability evidence. Distinct
     * from the random per-execution composition id.
     */
    id: string
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
  >(options: PipelinePreparationOptions & {
    /**
     * Stable author-supplied definition id, used to join this composition
     * with its Project Index definition and observability evidence. Distinct
     * from the random per-execution composition id.
     */
    id: string
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
  >(options: PipelinePreparationOptions & {
    /**
     * Stable author-supplied definition id, used to join this composition
     * with its Project Index definition and observability evidence. Distinct
     * from the random per-execution composition id.
     */
    id: string
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
  >(options: PipelinePreparationOptions & {
    /**
     * Stable author-supplied definition id, used to join this composition
     * with its Project Index definition and observability evidence. Distinct
     * from the random per-execution composition id.
     */
    id: string
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
  >(options: PipelinePreparationOptions & {
    /**
     * Stable author-supplied definition id, used to join this composition
     * with its Project Index definition and observability evidence. Distinct
     * from the random per-execution composition id.
     */
    id: string
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
  >(options: PipelinePreparationOptions & {
    /**
     * Stable author-supplied definition id, used to join this composition
     * with its Project Index definition and observability evidence. Distinct
     * from the random per-execution composition id.
     */
    id: string
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
  >(options: PipelinePreparationOptions & {
    /**
     * Stable author-supplied definition id, used to join this composition
     * with its Project Index definition and observability evidence. Distinct
     * from the random per-execution composition id.
     */
    id: string
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
  }): Promise<
    PipelineResult<Acc10<TCtx, S1, S2, S3, S4, S5, S6, S7, S8, S9, S10>>
  >

  // Fallback: 11+ steps
  function pipeline(options: PipelinePreparationOptions & {
    id: string
    context: Record<string, unknown>
    model?: unknown
    sessionId?: string
    validationRetry?: import('../generation/validation-retry').ValidationRetryOptions
    steps: StepAt<Record<string, unknown>>[]
  }): Promise<PipelineResult<Record<string, unknown>>>

  // ── Implementation (must immediately follow overloads) ────────

  async function pipeline(options: PipelinePreparationOptions & {
    id: string
    context: Record<string, unknown>
    model?: unknown
    steps: RuntimeStep[]
    sessionId?: string
    validationRetry?: import('../generation/validation-retry').ValidationRetryOptions
  }): Promise<PipelineResult<Record<string, unknown>>> {
    const {
      id,
      context,
      model,
      steps,
      sessionId,
      validationRetry,
      prepareInvocation,
    } = options

    const pipelineStart = Date.now()
    const results: AgentResult[] = []
    const agentIds = steps.map((s) =>
      s.agent && isAgent(s.agent) ? s.agent.id : s.name,
    )
    const runtime = createCompositionRuntime({
      kind: 'pipeline',
      id,
      agentIds,
      sessionId,
      prepareInvocation: prepareInvocation as PrepareInvocation | undefined,
    })

    return runtime.run(async (scope) => {
      // Start with seed context
      let accumulatedContext: Record<string, unknown> = { ...context }

      for (let i = 0; i < steps.length; i++) {
        const step = steps[i]

        // Determine step input: callback(ctx) or accumulated context
        const stepInput = step.input
          ? step.input(accumulatedContext)
          : accumulatedContext

        try {
          let result: AgentResult

          if (isFnStep(step)) {
            result = await scope.executeFunctionStep({
              label: step.name,
              index: i,
              run: () => step.fn(accumulatedContext),
              retry: step.retry,
            })
          } else if (isAgentStep(step)) {
            result = await scope.executeAgent({
              agent: step.agent,
              executor,
              label: step.name,
              index: i,
              input: stepInput,
              model,
              retry: step.retry,
              validationRetry,
              flowStep: true,
              invocation: {
                composition: { id, kind: 'pipeline' },
                step: { name: step.name, index: i },
                context: accumulatedContext,
              },
            })
          } else {
            throw new Error(
              `Pipeline step "${step.name}" has neither 'agent' nor 'fn'`,
            )
          }

          results.push(result)

          // Capture created values from agent creation tools.
          let stepOutput = result.output
          if (isAgentStep(step) && step.agent.tools) {
            const created: Record<string, unknown> = {}
            for (const [toolName, tool] of Object.entries(step.agent.tools)) {
              if (tool && typeof tool === 'object' && 'created' in tool) {
                const value = readCreatedToolValue(tool)
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
          accumulatedContext = {
            ...accumulatedContext,
            [step.name]: stepOutput,
          }
        } catch (err) {
          if (
            err instanceof PreparationError ||
            err instanceof ResourceReadError
          ) {
            throw err
          }
          const message = err instanceof Error ? err.message : String(err)
          throw new Error(`Pipeline step "${step.name}" failed: ${message}`)
        }
      }

      const durationMs = Date.now() - pipelineStart

      const stages = steps.map((step, index) => ({
        name: step.name,
        status: 'success',
        outputPreview: results[index]?.output,
      }))
      scope.report({
        preview: {
          kind: 'composition.report',
          compositionType: 'pipeline',
          compositionId: runtime.compositionId,
          status: 'success',
          wallTimeMs: durationMs,
          stages,
        },
        attributes: {
          primitive: 'composition.pipeline',
          compositionId: runtime.compositionId,
          stageCount: stages.length,
        },
      })

      return {
        status: 'completed' as const,
        context: accumulatedContext,
        finalOutput:
          results.length > 0 ? results[results.length - 1].output : undefined,
        results,
        durationMs,
        requestReceipts: scope.requestReceipts(),
      }
    })
  }

  return pipeline
}

function readCreatedToolValue(tool: object): unknown {
  const created = (tool as { created?: unknown }).created
  if (typeof created !== 'function') return created

  try {
    return created.call(tool)
  } catch (error) {
    if (isCreationToolNotCreatedError(error)) return undefined
    throw error
  }
}
