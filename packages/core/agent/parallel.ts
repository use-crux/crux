/**
 * Parallel composition — run named agents concurrently with typed results.
 *
 * Each agent receives the seed context as input and runs concurrently.
 * Results are accessible by agent name with full type inference.
 *
 * @module
 */

import { isAgent } from './agent'
import type { AgentLike, InferAgentLikeInput, InferAgentLikeOutput } from './agent'
import type { AgentExecutor, AgentResult } from './executor'
import { getRuntime } from '../runtime/runtime'
import { runWithExecutionContext, getExecutionContext } from '../runtime/execution-context'
import { observe } from '../observability'
import { executeWithRetry } from '../generation/retry'
import type { RetryOptions } from '../generation/retry'

/**
 * Intersect the input shapes of every agent in a `parallel()` map.
 *
 * Each agent receives the same `context`, so it must satisfy every agent's
 * input schema. Uses the variance trick: parameter positions are
 * contravariant, so distributing `(x: I) => void` over a union of inputs
 * collapses to the intersection.
 */
type IntersectionOfAgentInputs<TAgents extends Record<string, AgentLike>> = {
  [K in keyof TAgents]: (x: InferAgentLikeInput<TAgents[K]>) => void
}[keyof TAgents] extends (x: infer I) => void
  ? I
  : Record<string, unknown>

// ── Types ───────────────────────────────────────────────────────────

/** Discriminated result for `onError: 'continue'` mode. */
export type SettledResult<T> =
  | { status: 'success'; value: T; error?: undefined }
  | { status: 'error'; value?: undefined; error: Error }

/** Result of a parallel execution. */
export interface ParallelResult<TResults extends Record<string, AgentResult>> {
  /** Named results keyed by agent name. */
  results: TResults
  /** Settled results when `onError: 'continue'`. Only present in continue mode. */
  settled?: { [K in keyof TResults]: SettledResult<TResults[K]> }
  /** Total execution duration in milliseconds. */
  durationMs: number
}

/** Options for `parallel()`. */
export interface ParallelOptions<TAgents extends Record<string, AgentLike>> {
  /**
   * Seed context passed to all agents as input.
   *
   * Typed as the intersection of every agent's input schema — TypeScript
   * requires you to supply all fields that any agent declares.
   */
  context: IntersectionOfAgentInputs<TAgents>
  /** Named map of agents to run concurrently. */
  agents: TAgents
  /** Shared model (agent-level model takes precedence). */
  model?: unknown
  /** Error handling strategy. Default: `'fail-fast'`. */
  onError?: 'fail-fast' | 'continue'
  /** Session ID for grouping related composition runs in devtools. */
  sessionId?: string
  /** Execution retry/fallback applied to each branch. */
  retry?: RetryOptions
  /**
   * Validation-feedback retry for structured output.
   * Applied to all agents in this parallel group.
   */
  validationRetry?: import('../generation/validation-retry').ValidationRetryOptions
}

// ── Helpers ─────────────────────────────────────────────────────────

function generateCompositionId(): string {
  return `comp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// ── Factory ─────────────────────────────────────────────────────────

/**
 * Create a `parallel()` function bound to an executor.
 *
 * @param executor - SDK-specific agent executor.
 * @returns A `parallel()` function with named results.
 */
export function createParallel(executor: AgentExecutor) {
  /**
   * Run named agents concurrently with typed results.
   *
   * @example
   * ```ts
   * const { results } = await parallel({
   *   context: { content: articleDraft },
   *   agents: { factCheck: factChecker, style: styleReviewer },
   *   model,
   * })
   * results.factCheck.output  // typed as factChecker's output
   * results.style.output      // typed as styleReviewer's output
   * ```
   */
  return async function parallel<TAgents extends Record<string, AgentLike>>(
    options: ParallelOptions<TAgents>,
  ): Promise<
    ParallelResult<{
      [K in keyof TAgents]: AgentResult<InferAgentLikeOutput<TAgents[K]>>
    }>
  > {
    const { context, agents, model, onError = 'fail-fast', sessionId, retry, validationRetry } = options
    const entries = Object.entries(agents)

    type TypedResults = {
      [K in keyof TAgents]: AgentResult<InferAgentLikeOutput<TAgents[K]>>
    }

    if (entries.length === 0) {
      return { results: {} as TypedResults, durationMs: 0 }
    }

    const compositionId = generateCompositionId()
    const start = Date.now()
    const agentIds = entries.map(([key, a]) => (isAgent(a) ? a.id : key))
    const runtime = getRuntime()

    // Execute one agent with tracing
    const executeOne = async (key: string, agentLike: AgentLike, index: number): Promise<AgentResult> => {
      const parentCtx = getExecutionContext()
      const stepCtx = {
        ...parentCtx,
        stepId: `${compositionId}-${key}`,
        stepLabel: key,
        ...(sessionId ? { sessionId } : {}),
      }

      return observe.span(
        {
          name: key,
          family: 'agent',
          primitive: 'agent.run',
          attributes: {
            compositionId,
            agentId: isAgent(agentLike) ? agentLike.id : key,
            stepLabel: key,
            index,
          },
        },
        () =>
          runWithExecutionContext(stepCtx, async () => {
            const agentStart = Date.now()
            try {
              let result: AgentResult
              if (isAgent(agentLike)) {
                result = await executeWithRetry(
                  () =>
                    executor(agentLike, {
                      input: context as Record<string, unknown>,
                      model,
                      validationRetry,
                    }),
                  retry,
                )
              } else {
                const output = await executeWithRetry(
                  () => (agentLike as (input: unknown) => Promise<unknown>)(context),
                  retry,
                )
                result = {
                  agentId: key,
                  output,
                  durationMs: Date.now() - agentStart,
                }
              }

              runtime.instrumentationHooks?.onCompositionAgent?.({
                compositionId,
                agentId: result.agentId,
                index,
                status: 'success',
                durationMs: result.durationMs,
              })

              return result
            } catch (err) {
              const agentId = isAgent(agentLike) ? agentLike.id : key
              const errorMsg = err instanceof Error ? err.message : String(err)

              runtime.instrumentationHooks?.onCompositionAgent?.({
                compositionId,
                agentId,
                index,
                status: 'error',
                durationMs: Date.now() - agentStart,
                error: errorMsg,
              })

              throw err
            }
          }),
      )
    }

    return observe.span(
      {
        name: 'parallel',
        family: 'composition',
        primitive: 'composition.parallel',
        attributes: { compositionId, agentIds, onError },
      },
      async () => {
        // Emit composition:start
        runtime.instrumentationHooks?.onCompositionStart?.({
          compositionId,
          kind: 'parallel',
          agentIds,
        })

        try {
          if (onError === 'continue') {
            const settled = await Promise.allSettled(entries.map(([key, agent], i) => executeOne(key, agent, i)))
            const results = {} as Record<string, AgentResult>
            const settledMap = {} as Record<string, SettledResult<AgentResult>>

            for (const [i, [key]] of entries.entries()) {
              const s = settled[i]
              if (!s) continue
              if (s.status === 'fulfilled') {
                results[key] = s.value
                settledMap[key] = { status: 'success', value: s.value }
              } else {
                settledMap[key] = {
                  status: 'error',
                  error: s.reason instanceof Error ? s.reason : new Error(String(s.reason)),
                }
              }
            }

            const durationMs = Date.now() - start
            runtime.instrumentationHooks?.onCompositionEnd?.({
              compositionId,
              kind: 'parallel',
              status: Object.values(settledMap).some((s) => s.status === 'error') ? 'error' : 'success',
              durationMs,
              agentCount: entries.length,
            })
            emitParallelCompositionReport({
              compositionId,
              status: Object.values(settledMap).some((s) => s.status === 'error') ? 'error' : 'success',
              durationMs,
              branches: entries.map(([key], index) => {
                const settledResult = settledMap[key] ?? {
                  status: 'error' as const,
                  error: new Error('parallel branch did not produce a result'),
                }
                return {
                  id: key,
                  agentId: agentIds[index],
                  status: settledResult.status,
                  resultPreview: settledResult.status === 'success' ? settledResult.value.output : undefined,
                  error: settledResult.status === 'error' ? settledResult.error.message : undefined,
                  durationMs: settledResult.status === 'success' ? settledResult.value.durationMs : undefined,
                }
              }),
            })

            return {
              results: results as TypedResults,
              settled: settledMap as {
                [K in keyof TypedResults]: SettledResult<TypedResults[K]>
              },
              durationMs,
            }
          }

          // Default: fail-fast
          const resolved = await Promise.all(entries.map(([key, agent], i) => executeOne(key, agent, i)))

          const results = {} as Record<string, AgentResult>
          for (const [i, [key]] of entries.entries()) {
            const branch = resolved[i]
            if (branch) {
              results[key] = branch
            }
          }

          const durationMs = Date.now() - start
          runtime.instrumentationHooks?.onCompositionEnd?.({
            compositionId,
            kind: 'parallel',
            status: 'success',
            durationMs,
            agentCount: entries.length,
          })
          emitParallelCompositionReport({
            compositionId,
            status: 'success',
            durationMs,
            branches: entries.map(([key], index) => {
              const branch = resolved[index]
              return {
                id: key,
                agentId: branch?.agentId ?? agentIds[index],
                status: branch ? 'success' : 'skipped',
                resultPreview: branch?.output,
                durationMs: branch?.durationMs,
              }
            }),
          })

          return {
            results: results as TypedResults,
            durationMs,
          }
        } catch (err) {
          runtime.instrumentationHooks?.onCompositionEnd?.({
            compositionId,
            kind: 'parallel',
            status: 'error',
            durationMs: Date.now() - start,
            agentCount: entries.length,
          })
          throw err
        }
      },
    )
  }
}

function emitParallelCompositionReport(args: {
  compositionId: string
  status: 'success' | 'error'
  durationMs: number
  branches: readonly Record<string, unknown>[]
}): void {
  const spanId = observe.captureContext()?.currentSpanId
  if (!spanId) return
  const artifactId = observe.artifact({
    kind: 'composition.report',
    contentType: 'application/json',
    encoding: 'json',
    preview: {
      kind: 'composition.report',
      compositionType: 'parallel',
      compositionId: args.compositionId,
      status: args.status,
      wallTimeMs: args.durationMs,
      serialTimeMs: args.branches.reduce(
        (total, branch) => total + (typeof branch.durationMs === 'number' ? branch.durationMs : 0),
        0,
      ),
      branches: args.branches,
    },
    attributes: {
      primitive: 'composition.parallel',
      compositionId: args.compositionId,
      status: args.status,
      branchCount: args.branches.length,
    },
  })
  if (!artifactId) return
  observe.edge({
    edgeType: 'produced',
    from: { kind: 'span', id: spanId },
    to: { kind: 'artifact', id: artifactId },
    attributes: { primitive: 'composition.parallel', compositionId: args.compositionId },
  })
}
