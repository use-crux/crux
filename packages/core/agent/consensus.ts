/**
 * Consensus composition — run multiple agents and determine a winner via voting.
 *
 * Built on top of `parallel()` — runs all agents concurrently, extracts a
 * vote value from each result, and picks the most frequent value. Supports
 * quorum validation (majority, unanimous, or specific count).
 *
 * @module
 */

import { createParallel } from './parallel'
import { isAgent } from './agent'
import type { AgentLike, InferAgentLikeInput, InferAgentLikeOutput } from './agent'
import type { AgentExecutor, AgentResult } from './executor'
import { getRuntime } from '../runtime/runtime'
import { observe } from '../observability'
import type { RetryOptions } from '../retry'

// ── Types ───────────────────────────────────────────────────────────

/**
 * Intersect the input types of every voter agent (consensus seed must
 * satisfy each agent's input schema).
 */
type ConsensusInput<TAgents extends readonly AgentLike[]> = {
  [K in keyof TAgents]: (x: InferAgentLikeInput<TAgents[K]>) => void
}[number] extends (x: infer I) => void
  ? I
  : unknown

/** Union of every voter agent's output type — used to type the `extract` callback. */
type ConsensusOutput<TAgents extends readonly AgentLike[]> = InferAgentLikeOutput<TAgents[number]>

/** Options for `consensus()`. */
export interface ConsensusOptions<
  TAgents extends readonly AgentLike[] = readonly AgentLike[],
  TVote extends string = string,
> {
  /** Agents to run as voters (can repeat the same agent). */
  agents: TAgents
  /** Input data passed to all agents. */
  input: ConsensusInput<TAgents>
  /** Shared model (agent-level model takes precedence). */
  model?: unknown
  /**
   * Extract a vote string from each agent's result.
   *
   * `result.output` is typed as the union of all voter agents' output types.
   * Return type may be narrowed with a string-literal `TVote` for stricter
   * `result` / `votes` typing.
   */
  extract: (result: AgentResult<ConsensusOutput<TAgents>>) => TVote
  /** Quorum requirement. Default: `'majority'`. */
  quorum?: 'majority' | 'unanimous' | number
  /** Session ID for grouping related composition runs in devtools. */
  sessionId?: string
  /** Execution retry/fallback applied to each voter. */
  retry?: RetryOptions
  /**
   * Validation-feedback retry for structured output.
   * Applied to all voter agents.
   */
  validationRetry?: import('../validation-retry').ValidationRetryOptions
}

/** The result of a consensus vote. */
export interface ConsensusResult<TVote extends string = string> {
  /** The winning vote value. */
  result: TVote
  /** Vote breakdown: { value: count }. */
  votes: Record<TVote, number>
  /** Each agent's full result. */
  details: AgentResult[]
  /** Agreement ratio (0–1): winner count / total. */
  agreement: number
  /** Total duration in milliseconds. */
  durationMs: number
}

/** Error thrown when quorum is not met. */
export class ConsensusError<TVote extends string = string> extends Error {
  constructor(
    message: string,
    public readonly votes: Record<TVote, number>,
    public readonly quorum: 'majority' | 'unanimous' | number,
  ) {
    super(message)
    this.name = 'ConsensusError'
  }
}

// ── Factory ─────────────────────────────────────────────────────────

/**
 * Create a `consensus()` function bound to an executor.
 *
 * @param executor - SDK-specific agent executor.
 * @returns A `consensus()` function.
 */
export function createConsensus(executor: AgentExecutor) {
  const parallel = createParallel(executor)

  /**
   * Run multiple agents and determine a winner via voting.
   *
   * @param options - Consensus options.
   * @returns The winning value, vote breakdown, and all agent results.
   *
   * @example
   * ```ts
   * const decision = await consensus({
   *   agents: [classifier1, classifier2, classifier3],
   *   input: { ticket: supportTicket },
   *   extract: (result) => result.output.category,
   *   quorum: 'majority',
   * })
   * // decision.result = 'billing' (winning category)
   * // decision.votes = { billing: 2, shipping: 1 }
   * ```
   */
  return async function consensus<TAgents extends readonly AgentLike[], TVote extends string = string>(
    options: ConsensusOptions<TAgents, TVote>,
  ): Promise<ConsensusResult<TVote>> {
    const { agents, input, model, extract, quorum = 'majority', sessionId, retry, validationRetry } = options
    const start = Date.now()
    const compositionId = `comp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const runtime = getRuntime()
    const agentIds = agents.map((a, i) => (isAgent(a) ? a.id : `voter-${i}`))

    return observe.span(
      {
        name: 'consensus',
        family: 'composition',
        primitive: 'composition.consensus',
        attributes: { compositionId, agentIds, quorum },
      },
      async () => {
        // Emit consensus composition:start
        runtime.instrumentationHooks?.onCompositionStart?.({
          compositionId,
          kind: 'consensus',
          agentIds,
        })
        // Convert array to named map for parallel()
        const agentMap: Record<string, AgentLike> = {}
        for (let i = 0; i < agents.length; i++) {
          agentMap[`voter-${i}`] = agents[i]
        }

        // Run all agents via parallel (inherits error handling)
        const parallelResult = await parallel({
          context: (typeof input === 'object' && input !== null
            ? (input as Record<string, unknown>)
            : { _input: input }) as never,
          agents: agentMap,
          model,
          sessionId,
          retry,
          validationRetry,
        })
        const allResults = Object.values(parallelResult.results) as AgentResult<ConsensusOutput<TAgents>>[]

        // Count votes
        const votes: Record<string, number> = {}
        const extractedVotes: TVote[] = []
        for (const result of allResults) {
          const vote = extract(result)
          extractedVotes.push(vote)
          votes[vote] = (votes[vote] ?? 0) + 1
        }

        // Find winner (most frequent; first for ties)
        let winner = '' as TVote
        let winnerCount = 0
        for (const [value, count] of Object.entries(votes)) {
          if (count > winnerCount) {
            winner = value as TVote
            winnerCount = count
          }
        }

        const agreement = allResults.length > 0 ? winnerCount / allResults.length : 0

        // Validate quorum
        const emitEnd = (status: 'success' | 'error') => {
          runtime.instrumentationHooks?.onCompositionEnd?.({
            compositionId,
            kind: 'consensus',
            status,
            durationMs: Date.now() - start,
            agentCount: allResults.length,
            agreement,
          })
        }

        const votesByVote = votes as Record<TVote, number>

        if (quorum === 'unanimous' && agreement < 1) {
          emitEnd('error')
          throw new ConsensusError<TVote>(
            `Consensus quorum not met: unanimous required but agreement is ${(agreement * 100).toFixed(0)}%`,
            votesByVote,
            quorum,
          )
        }
        if (quorum === 'majority' && winnerCount <= allResults.length / 2) {
          emitEnd('error')
          throw new ConsensusError<TVote>(
            `Consensus quorum not met: majority required but winner "${winner}" has ${winnerCount}/${allResults.length} votes`,
            votesByVote,
            quorum,
          )
        }
        if (typeof quorum === 'number' && winnerCount < quorum) {
          emitEnd('error')
          throw new ConsensusError<TVote>(
            `Consensus quorum not met: ${quorum} votes required but winner "${winner}" has ${winnerCount}`,
            votesByVote,
            quorum,
          )
        }

        emitEnd('success')
        emitConsensusCompositionReport({
          compositionId,
          agreement,
          quorum,
          votes: allResults.map((result, index) => ({
            agent: agentIds[index] ?? `voter-${index}`,
            answer: extractedVotes[index],
            resultPreview: result.output,
            durationMs: result.durationMs,
          })),
          durationMs: Date.now() - start,
        })

        return {
          result: winner,
          votes: votesByVote,
          details: allResults,
          agreement,
          durationMs: Date.now() - start,
        }
      },
    )
  }
}

function emitConsensusCompositionReport(args: {
  compositionId: string
  agreement: number
  quorum: 'majority' | 'unanimous' | number
  votes: readonly Record<string, unknown>[]
  durationMs: number
}): void {
  const spanId = observe.captureContext()?.currentSpanId
  if (!spanId) return
  const artifactId = observe.artifact({
    kind: 'composition.report',
    contentType: 'application/json',
    encoding: 'json',
    preview: {
      kind: 'composition.report',
      compositionType: 'consensus',
      compositionId: args.compositionId,
      status: 'success',
      agreement: args.agreement,
      quorum: args.quorum,
      votes: args.votes,
      wallTimeMs: args.durationMs,
    },
    attributes: {
      primitive: 'composition.consensus',
      compositionId: args.compositionId,
      agreement: args.agreement,
      voterCount: args.votes.length,
    },
  })
  if (!artifactId) return
  observe.edge({
    edgeType: 'produced',
    from: { kind: 'span', id: spanId },
    to: { kind: 'artifact', id: artifactId },
    attributes: { primitive: 'composition.consensus', compositionId: args.compositionId },
  })
}
