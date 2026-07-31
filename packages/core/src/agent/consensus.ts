/**
 * Consensus composition — run multiple agents and determine a winner via voting.
 *
 * Runs all agents concurrently through the shared composition runtime,
 * extracts a vote value from each result, and picks the most frequent value.
 * Supports quorum validation (majority, unanimous, or specific count).
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
import type { OperationResultMeta } from '../observability'
import type { RetryOptions } from '../generation/retry'
import type {
  ConsensusInvocationContext,
  PrepareInvocation,
} from '../request/prepare/invocation'
import type { CompositionRequestReceiptTree } from '../request/receipt/tree'
import type { EffectScopeRef } from '../effect'

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
type ConsensusOutput<TAgents extends readonly AgentLike[]> =
  InferAgentLikeOutput<TAgents[number]>

/** Options for `consensus()`. */
export interface ConsensusOptions<
  TAgents extends readonly AgentLike[] = readonly AgentLike[],
  TVote extends string = string,
> {
  /**
   * Stable author-supplied definition id, used to join this composition
   * with its Project Index definition and observability evidence. Distinct
   * from the random per-execution composition id.
   */
  id: string
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
  validationRetry?: import('../generation/validation-retry').ValidationRetryOptions
  /** Prepare each managed voter invocation before child I/O. */
  prepareInvocation?: PrepareInvocation<unknown, ConsensusInvocationContext>
}

/** The result of a consensus vote. */
export interface ConsensusResult<TVote extends string = string> {
  /** Exact identity of the `composition.consensus` operation that produced this result. */
  readonly _meta: OperationResultMeta
  /** In-process reference to this composition's passive rollback boundary. */
  readonly effects: EffectScopeRef
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
  /** Linked provider-request evidence for managed candidates. */
  requestReceipts: CompositionRequestReceiptTree
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
  return async function consensus<
    TAgents extends readonly AgentLike[],
    TVote extends string = string,
  >(
    options: ConsensusOptions<TAgents, TVote>,
  ): Promise<ConsensusResult<TVote>> {
    const {
      id,
      agents,
      input,
      model,
      extract,
      quorum = 'majority',
      sessionId,
      retry,
      validationRetry,
      prepareInvocation,
    } = options
    const start = Date.now()
    const agentIds = agents.map((a, i) => (isAgent(a) ? a.id : `voter-${i}`))
    const runtime = createCompositionRuntime({
      kind: 'consensus',
      id,
      agentIds,
      sessionId,
      attributes: { quorum },
      prepareInvocation: prepareInvocation as PrepareInvocation | undefined,
    })

    return runtime.run(async (scope) => {
      const voterInput =
        typeof input === 'object' && input !== null
          ? (input as Record<string, unknown>)
          : { _input: input }
      const allResults = (await Promise.all(
        agents.map((agent, index) =>
          scope.executeAgent({
            agent,
            executor,
            label: `voter-${index}`,
            index,
            input: voterInput,
            model,
            retry,
            validationRetry,
            invocation: {
              composition: { id, kind: 'consensus' },
              candidate: { index },
              input: voterInput,
            },
          }),
        ),
      )) as AgentResult<ConsensusOutput<TAgents>>[]

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

      const agreement =
        allResults.length > 0 ? winnerCount / allResults.length : 0

      // Validate quorum
      const votesByVote = votes as Record<TVote, number>

      if (quorum === 'unanimous' && agreement < 1) {
        throw new ConsensusError<TVote>(
          `Consensus quorum not met: unanimous required but agreement is ${(agreement * 100).toFixed(0)}%`,
          votesByVote,
          quorum,
        )
      }
      if (quorum === 'majority' && winnerCount <= allResults.length / 2) {
        throw new ConsensusError<TVote>(
          `Consensus quorum not met: majority required but winner "${winner}" has ${winnerCount}/${allResults.length} votes`,
          votesByVote,
          quorum,
        )
      }
      if (typeof quorum === 'number' && winnerCount < quorum) {
        throw new ConsensusError<TVote>(
          `Consensus quorum not met: ${quorum} votes required but winner "${winner}" has ${winnerCount}`,
          votesByVote,
          quorum,
        )
      }

      const voteDetails = allResults.map((result, index) => ({
        agent: agentIds[index] ?? `voter-${index}`,
        answer: extractedVotes[index],
        resultPreview: result.output,
        durationMs: result.durationMs,
      }))
      scope.report({
        preview: {
          kind: 'composition.report',
          compositionType: 'consensus',
          compositionId: runtime.compositionId,
          status: 'success',
          agreement,
          quorum,
          votes: voteDetails,
          wallTimeMs: Date.now() - start,
        },
        attributes: {
          primitive: 'composition.consensus',
          compositionId: runtime.compositionId,
          agreement,
          voterCount: voteDetails.length,
        },
      })

      return {
        result: winner,
        votes: votesByVote,
        details: allResults,
        agreement,
        durationMs: Date.now() - start,
        requestReceipts: scope.requestReceipts(),
      }
    })
  }
}
