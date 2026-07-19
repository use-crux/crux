/**
 * Delegate — orchestration wrapper combining handoff + subagent execution.
 *
 * Wraps a handoff contract with an execution function that runs a subagent,
 * validates the result through the handoff, and exposes everything as a
 * callable focused tool for the main agent.
 *
 * Three-layer validation:
 * 1. `argsSchema` — what the LLM provides when calling the tool
 * 2. `handoff.inputSchema` — validates the subagent's return value
 * 3. `handoff.outputSchema` — transformed data for the consumer
 *
 * @module
 */

import { z } from 'zod'
import type { HandoffInstance } from './handoff'
import type { ToolDef } from '../types/tool'
import { observe, type OperationResultMeta } from '../observability'
import { withOperationResultMeta } from '../observability/internal/result-meta'

// ── Types ───────────────────────────────────────────────────────────

/** Configuration for `delegate()`. */
export interface DelegateConfig<
  TArgs extends z.ZodType,
  THandoffInput extends z.ZodType,
  THandoffOutput extends z.ZodType,
  TCtx = unknown,
> {
  /** Unique identifier for this delegation. */
  id: string
  /** Schema for what the orchestrating agent provides when invoking this delegation. */
  argsSchema: TArgs
  /** Handoff contract that validates and transforms the subagent's result. */
  handoff: HandoffInstance<THandoffInput, THandoffOutput>
  /**
   * Execute the subagent. Receives validated tool args and optional typed context.
   * Returns the raw subagent result (validated by the handoff's inputSchema).
   */
  execute: (args: z.infer<TArgs>, ctx: TCtx) => Promise<z.infer<THandoffInput>>
}

/** The result of a delegation, after handoff validation and transform. */
export interface DelegateResult<TOutput> {
  /** Exact identity of the `delegate.invoke` operation that produced this result. */
  readonly _meta: OperationResultMeta
  /** Delegation identifier. */
  delegateId: string
  /** Transformed data from the handoff. */
  data: TOutput
  /** LLM-generated summary from the handoff, if configured. */
  summary?: string
  /** Duration of the delegation in milliseconds. */
  durationMs: number
}

/** A delegate instance with run() and asTools() methods. */
export interface Delegate<
  TArgs extends z.ZodType,
  THandoffInput extends z.ZodType,
  THandoffOutput extends z.ZodType,
  TCtx = unknown,
> {
  /** The unique identifier for this delegation. */
  readonly id: string
  /** The args schema for the tool. */
  readonly argsSchema: TArgs
  /** The handoff contract. */
  readonly handoff: HandoffInstance<THandoffInput, THandoffOutput>

  /**
   * Execute the delegation: run subagent → validate via handoff → return transformed result.
   *
   * @param args - Tool arguments (validated against argsSchema).
   * @param ctx - Typed execution context (e.g., framework-specific tool context, action context).
   */
  run(args: z.infer<TArgs>, ctx: TCtx): Promise<DelegateResult<z.infer<THandoffOutput>>>

  /**
   * Create focused tool definitions for delegation.
   *
   * Returns a record with a single `delegate` tool that invokes the subagent.
   * The tool uses `argsSchema` as its parameter schema.
   *
   * For frameworks that need custom tool shapes (e.g., Convex Agent's `createTool`),
   * use `.run()` directly instead — it gives you full control over context threading.
   */
  asTools(options?: { description?: string }): {
    delegate: ToolDef<z.infer<TArgs>, string>
  }
}

// ── Implementation ──────────────────────────────────────────────────

/**
 * Create a delegation that wraps handoff + subagent execution.
 *
 * @param config - Configuration with id, argsSchema, handoff, and execute function.
 * @returns A `Delegate` with run() and asTools() methods.
 *
 * @example
 * ```ts
 * // Simple: use asTools() for AI SDK-compatible tool format
 * const researchDelegation = delegate({
 *   id: 'delegate-research',
 *   argsSchema: z.object({ query: z.string() }),
 *   handoff: researchToWriter,
 *   execute: async (args) => await runResearchSubagent(args.query),
 * })
 * const { delegate: research } = researchDelegation.asTools({ description: 'Delegate research' })
 *
 * // Advanced: use .run() with typed context for framework-specific tools
 * type MyCtx = { actionCtx: ActionCtx; projectId: string }
 * const delegation = delegate<typeof argsSchema, typeof inputSchema, typeof outputSchema, MyCtx>({
 *   id: 'delegate-research',
 *   argsSchema,
 *   handoff: myHandoff,
 *   execute: async (args, ctx) => {
 *     // ctx is typed as MyCtx
 *     return await ctx.actionCtx.runAction(ref, { projectId: ctx.projectId, ...args })
 *   },
 * })
 * // In your framework's tool factory:
 * const tool = createTool({
 *   inputSchema: delegation.argsSchema,
 *   execute: (toolCtx, args) => delegation.run(args, { actionCtx: ctx, projectId }),
 * })
 * ```
 */
export function delegate<
  TArgs extends z.ZodType,
  THandoffInput extends z.ZodType,
  THandoffOutput extends z.ZodType,
  TCtx = unknown,
>(
  config: DelegateConfig<TArgs, THandoffInput, THandoffOutput, TCtx>,
): Delegate<TArgs, THandoffInput, THandoffOutput, TCtx> {
  const { id, argsSchema, handoff, execute } = config

  async function run(args: z.infer<TArgs>, ctx: TCtx): Promise<DelegateResult<z.infer<THandoffOutput>>> {
    const start = Date.now()

    // Validate tool args
    const validatedArgs = argsSchema.parse(args)

    const inputSize = JSON.stringify(validatedArgs).length

    const delegateSpan = observe.openSpan({
      name: id,
      primitive: 'delegate.invoke',
      attributes: { delegateId: id, handoffId: handoff.id, inputSize },
    })

    try {
      const result = await delegateSpan.withContext(async () => {
        const observedContext = observe.captureContext()
        const inputArtifactId = observe.artifact({
          kind: 'input',
          contentType: 'application/json',
          encoding: 'json',
          preview: validatedArgs,
          sizeBytes: inputSize,
          attributes: { delegateId: id, handoffId: handoff.id, role: 'delegate.input' },
        })
        if (observedContext?.currentSpanId && inputArtifactId) {
          observe.edge({
            edgeType: 'consumed',
            from: { kind: 'artifact', id: inputArtifactId },
            to: { kind: 'span', id: observedContext.currentSpanId },
            attributes: { delegateId: id, handoffId: handoff.id },
          })
        }
        const rawResult = await execute(validatedArgs, ctx)

        const payload = await handoff.prepare(rawResult)

        const durationMs = Date.now() - start
        const outputSize = JSON.stringify(payload.data).length
        const outputArtifactId = observe.artifact({
          kind: 'output',
          contentType: 'application/json',
          encoding: 'json',
          preview: {
            data: payload.data,
            ...(payload.summary !== undefined ? { summary: payload.summary } : {}),
          },
          sizeBytes: outputSize,
          attributes: {
            delegateId: id,
            handoffId: handoff.id,
            role: 'delegate.output',
            durationMs,
          },
        })
        if (observedContext?.currentSpanId && outputArtifactId) {
          observe.edge({
            edgeType: 'produced',
            from: { kind: 'span', id: observedContext.currentSpanId },
            to: { kind: 'artifact', id: outputArtifactId },
            attributes: { delegateId: id, handoffId: handoff.id },
          })
        }
        const reportArtifactId = observe.artifact({
          kind: 'delegate.report',
          contentType: 'application/json',
          encoding: 'json',
          preview: {
            kind: 'delegate.report',
            delegateId: id,
            handoffId: handoff.id,
            inputSize,
            outputSize,
            args: validatedArgs,
            resultPreview: payload.data,
            ...(payload.summary !== undefined ? { summary: payload.summary } : {}),
          },
          sizeBytes: outputSize,
          attributes: {
            delegateId: id,
            handoffId: handoff.id,
            inputSize,
            outputSize,
            durationMs,
          },
        })
        if (observedContext?.currentSpanId && reportArtifactId) {
          observe.edge({
            edgeType: 'produced',
            from: { kind: 'span', id: observedContext.currentSpanId },
            to: { kind: 'artifact', id: reportArtifactId },
            attributes: { delegateId: id, handoffId: handoff.id },
          })
        }

        return {
          delegateId: id,
          data: payload.data,
          ...(payload.summary !== undefined ? { summary: payload.summary } : {}),
          durationMs,
        }
      })
      const observedResult = withOperationResultMeta(result, {
        traceId: delegateSpan.traceId,
        spanId: delegateSpan.spanId,
      })
      delegateSpan.end()
      return observedResult
    } catch (error) {
      delegateSpan.error(error)
      throw error
    }
  }

  function asTools(options?: { description?: string }): {
    delegate: ToolDef<z.infer<TArgs>, string>
  } {
    return {
      delegate: {
        description:
          options?.description ??
          `Delegate "${id}" to a specialist agent. Provide the required arguments and the subagent will execute the task and return its results.`,
        parameters: argsSchema as z.ZodType<z.infer<TArgs>>,
        async execute(args: z.infer<TArgs>): Promise<string> {
          const result = await run(args, undefined as TCtx)
          return JSON.stringify({
            data: result.data,
            ...(result.summary !== undefined ? { summary: result.summary } : {}),
          })
        },
      } satisfies ToolDef<z.infer<TArgs>, string>,
    }
  }

  return {
    id,
    argsSchema,
    handoff,
    run,
    asTools,
  }
}
