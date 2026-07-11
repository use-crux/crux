/**
 * Parallel composition — run named agents concurrently with typed results.
 *
 * Each agent receives the seed context as input and runs concurrently.
 * Results are accessible by agent name with full type inference.
 *
 * @module
 */

import { isAgent } from './agent'
import type {
  AgentLike,
  InferAgentLikeInput,
  InferAgentLikeOutput,
} from './agent'
import type { AgentExecutor, AgentResult } from './executor'
import { createCompositionRuntime } from './composition-runtime'
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
  /** Stable author-supplied definition id, distinct from the random per-execution composition id. */
  id: string
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
    const {
      id,
      context,
      agents,
      model,
      onError = 'fail-fast',
      sessionId,
      retry,
      validationRetry,
    } = options
    const entries = Object.entries(agents)

    type TypedResults = {
      [K in keyof TAgents]: AgentResult<InferAgentLikeOutput<TAgents[K]>>
    }

    if (entries.length === 0) {
      return { results: {} as TypedResults, durationMs: 0 }
    }

    const start = Date.now()
    const agentIds = entries.map(([key, a]) => (isAgent(a) ? a.id : key))
    const runtime = createCompositionRuntime({
      kind: 'parallel',
      id,
      agentIds,
      sessionId,
      attributes: { onError },
    })

    return runtime.run(async (scope) => {
      const executeOne = (
        key: string,
        agentLike: AgentLike,
        index: number,
      ): Promise<AgentResult> =>
        scope.executeAgent({
          agent: agentLike,
          executor,
          label: key,
          index,
          input: context,
          model,
          retry,
          validationRetry,
        })

      try {
        if (onError === 'continue') {
          const settled = await Promise.allSettled(
            entries.map(([key, agent], i) => executeOne(key, agent, i)),
          )
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
                error:
                  s.reason instanceof Error
                    ? s.reason
                    : new Error(String(s.reason)),
              }
            }
          }

          const durationMs = Date.now() - start
          const status = Object.values(settledMap).some(
            (s) => s.status === 'error',
          )
            ? 'error'
            : 'success'
          const branches = entries.map(([key], index) => {
            const settledResult = settledMap[key] ?? {
              status: 'error' as const,
              error: new Error('parallel branch did not produce a result'),
            }
            return {
              id: key,
              agentId: agentIds[index],
              status: settledResult.status,
              resultPreview:
                settledResult.status === 'success'
                  ? settledResult.value.output
                  : undefined,
              error:
                settledResult.status === 'error'
                  ? settledResult.error.message
                  : undefined,
              durationMs:
                settledResult.status === 'success'
                  ? settledResult.value.durationMs
                  : undefined,
            }
          })
          scope.report({
            preview: {
              kind: 'composition.report',
              compositionType: 'parallel',
              compositionId: runtime.compositionId,
              status,
              wallTimeMs: durationMs,
              serialTimeMs: branches.reduce(
                (total, branch) =>
                  total +
                  (typeof branch.durationMs === 'number'
                    ? branch.durationMs
                    : 0),
                0,
              ),
              branches,
            },
            attributes: {
              primitive: 'composition.parallel',
              compositionId: runtime.compositionId,
              status,
              branchCount: branches.length,
            },
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
        const resolved = await Promise.all(
          entries.map(([key, agent], i) => executeOne(key, agent, i)),
        )

        const results = {} as Record<string, AgentResult>
        for (const [i, [key]] of entries.entries()) {
          const branch = resolved[i]
          if (branch) {
            results[key] = branch
          }
        }

        const durationMs = Date.now() - start
        const branches = entries.map(([key], index) => {
          const branch = resolved[index]
          return {
            id: key,
            agentId: branch?.agentId ?? agentIds[index],
            status: branch ? 'success' : 'skipped',
            resultPreview: branch?.output,
            durationMs: branch?.durationMs,
          }
        })
        scope.report({
          preview: {
            kind: 'composition.report',
            compositionType: 'parallel',
            compositionId: runtime.compositionId,
            status: 'success',
            wallTimeMs: durationMs,
            serialTimeMs: branches.reduce(
              (total, branch) =>
                total +
                (typeof branch.durationMs === 'number' ? branch.durationMs : 0),
              0,
            ),
            branches,
          },
          attributes: {
            primitive: 'composition.parallel',
            compositionId: runtime.compositionId,
            status: 'success',
            branchCount: branches.length,
          },
        })

        return {
          results: results as TypedResults,
          durationMs,
        }
      } catch (err) {
        throw err
      }
    })
  }
}
