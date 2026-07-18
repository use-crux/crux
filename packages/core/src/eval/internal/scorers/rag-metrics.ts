/**
 *
 * Deterministic RAG scorers for the public `scorers.rag.*` namespace.
 *
 * These are pure code metrics over retrieved source identity, citation
 * identity, and recipe trace shape. Model-judged relevance remains an
 * extension path through the existing generic judge scorer.
 *
 * @internal
 * @module
 */

import { SCORER_INTERNAL, type ContextualScorerRun, type ScorerRunContext } from './runtime'
import type { Score, Scorer, ScorerArgs } from './types'

interface ExpectedSource {
  sourceId: string
  chunkId?: string
}

interface RankedHit {
  source?: { id?: string }
  chunkId?: string
  rank?: number
}

interface CitationLike {
  sourceId?: string
  chunkId?: string
  grounded?: boolean
}

interface TraceLike {
  id?: unknown
  recipeId?: unknown
  retrieverId?: unknown
  startedAt?: unknown
  durationMs?: unknown
  input?: unknown
  resultCount?: unknown
  steps?: unknown
  warnings?: unknown
  errors?: unknown
}

/** Options for deterministic source-identity RAG metrics. */
export interface RagMetricOptions<N extends string = string> {
  /** Score name override. */
  name?: N
}

/** Options for `scorers.rag.contextPrecision()`. */
export interface RagContextPrecisionOptions<N extends string = string> extends RagMetricOptions<N> {
  /** Evaluate only the first `k` retrieved contexts. Defaults to all returned contexts. */
  k?: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isExpectedSource(value: unknown): value is ExpectedSource {
  return (
    isRecord(value) &&
    typeof value.sourceId === 'string' &&
    (value.chunkId === undefined || typeof value.chunkId === 'string')
  )
}

function parseExpectedSources(expected: unknown, name: string): ExpectedSource[] | undefined {
  if (expected === undefined) return undefined
  if (isRecord(expected) && Array.isArray(expected.sources) && expected.sources.every(isExpectedSource)) {
    return expected.sources
  }
  throw new TypeError(
    `scorers.rag ('${name}'): \`expected\` must be \`{ sources: Array<{ sourceId: string; chunkId?: string }> }\`.`,
  )
}

function rankedHitsFromOutput(output: unknown): RankedHit[] | undefined {
  const list = Array.isArray(output) ? output : isRecord(output) && Array.isArray(output.hits) ? output.hits : undefined
  if (list === undefined || !list.every(isRecord)) return undefined
  const hits = list as RankedHit[]
  if (hits.length > 1 && hits.every((hit) => typeof hit.rank === 'number')) {
    return [...hits].sort((a, b) => (a.rank as number) - (b.rank as number))
  }
  return hits
}

function rankedHits(
  args: ScorerArgs<unknown, unknown, unknown>,
  context: ScorerRunContext | undefined,
): RankedHit[] | undefined {
  const fromOutput = rankedHitsFromOutput(args.output)
  if (fromOutput !== undefined) return fromOutput
  const signals = context?.signals?.retrievalHits
  if (signals !== undefined && signals.length > 0) return [...signals]
  return undefined
}

function hitMatches(hit: RankedHit, source: ExpectedSource): boolean {
  return hit.source?.id === source.sourceId && (source.chunkId === undefined || hit.chunkId === source.chunkId)
}

function citationMatches(citation: CitationLike, source: ExpectedSource): boolean {
  return citation.sourceId === source.sourceId && (source.chunkId === undefined || citation.chunkId === source.chunkId)
}

function sourceKey(source: ExpectedSource): string {
  return `${source.sourceId}\u0000${source.chunkId ?? ''}`
}

function scoreSourceMetric(
  name: string,
  args: ScorerArgs<unknown, unknown, unknown>,
  context: ScorerRunContext | undefined,
  metric: (hits: readonly RankedHit[], sources: readonly ExpectedSource[]) => number,
): Score {
  const sources = parseExpectedSources(args.expected, name)
  if (sources === undefined)
    return {
      name,
      score: null,
      metadata: { reason: 'expected sources are required' },
    }
  if (sources.length === 0)
    return {
      name,
      score: null,
      metadata: { reason: 'expected sources are empty' },
    }
  const hits = rankedHits(args, context)
  if (hits === undefined) {
    return {
      name,
      score: null,
      metadata: {
        reason: 'no retrieval hits found on the output or captured retrieval signals',
      },
    }
  }
  return { name, score: metric(hits, sources) }
}

function makeCodeScorer<N extends string>(name: N, run: ContextualScorerRun): Scorer<unknown, unknown, unknown, N> {
  const plain = ((args: ScorerArgs<unknown, unknown, unknown>) => run(args, undefined)) satisfies Scorer<
    unknown,
    unknown,
    unknown,
    N
  >
  return Object.assign(plain, {
    scorerName: name,
    costClass: 'code' as const,
    [SCORER_INTERNAL]: run,
  })
}

/** Recall over expected sources in the first `k` retrieved hits. */
export function ragRecallAtK(k: number): Scorer<unknown, unknown, unknown, `rag.recall@${number}`> {
  const name = `rag.recall@${k}` as const
  return makeCodeScorer(name, (args, context) =>
    scoreSourceMetric(name, args, context, (hits, sources) => {
      const topK = hits.slice(0, k)
      const found = sources.filter((source) => topK.some((hit) => hitMatches(hit, source)))
      return found.length / sources.length
    }),
  )
}

/** Mean reciprocal rank of the first expected source. */
export function ragMrr<const N extends string = 'rag.mrr'>(
  opts?: RagMetricOptions<N>,
): Scorer<unknown, unknown, unknown, N> {
  const name = opts?.name ?? ('rag.mrr' as N)
  return makeCodeScorer(name, (args, context) =>
    scoreSourceMetric(name, args, context, (hits, sources) => {
      const index = hits.findIndex((hit) => sources.some((source) => hitMatches(hit, source)))
      return index === -1 ? 0 : 1 / (index + 1)
    }),
  )
}

/** Fraction of expected sources retrieved anywhere in the result set. */
export function ragExpectedSourceCoverage<const N extends string = 'rag.expectedSourceCoverage'>(
  opts?: RagMetricOptions<N>,
): Scorer<unknown, unknown, unknown, N> {
  const name = opts?.name ?? ('rag.expectedSourceCoverage' as N)
  return makeCodeScorer(name, (args, context) =>
    scoreSourceMetric(name, args, context, (hits, sources) => {
      const found = new Set<string>()
      for (const source of sources) {
        if (hits.some((hit) => hitMatches(hit, source))) found.add(sourceKey(source))
      }
      return found.size / sources.length
    }),
  )
}

/** Fraction of returned contexts that match expected source identity. */
export function ragContextPrecision<const N extends string = 'rag.contextPrecision'>(
  opts?: RagContextPrecisionOptions<N>,
): Scorer<unknown, unknown, unknown, N> {
  const name = opts?.name ?? ('rag.contextPrecision' as N)
  return makeCodeScorer(name, (args, context) =>
    scoreSourceMetric(name, args, context, (hits, sources) => {
      const measured = hits.slice(0, opts?.k ?? hits.length)
      if (measured.length === 0) return 0
      return measured.filter((hit) => sources.some((source) => hitMatches(hit, source))).length / measured.length
    }),
  )
}

function citationsFromOutput(output: unknown): readonly CitationLike[] | undefined {
  const list = isRecord(output) && Array.isArray(output.citations) ? output.citations : undefined
  if (list === undefined || !list.every(isRecord)) return undefined
  return list as CitationLike[]
}

function citationsFromSignals(context: ScorerRunContext | undefined): readonly CitationLike[] | undefined {
  const signals = context?.signals?.citations
  return signals !== undefined && signals.length > 0 ? signals : undefined
}

/** Fraction of cited sources that are grounded and match expected sources when provided. */
export function ragCitationValidity<const N extends string = 'rag.citationValidity'>(
  opts?: RagMetricOptions<N>,
): Scorer<unknown, unknown, unknown, N> {
  const name = opts?.name ?? ('rag.citationValidity' as N)
  return makeCodeScorer(name, (args, context) => {
    const citations = citationsFromOutput(args.output) ?? citationsFromSignals(context)
    if (citations === undefined || citations.length === 0) {
      return {
        name,
        score: null,
        metadata: {
          reason: 'no citations found on output or captured citation signals',
        },
      }
    }
    const sources = parseExpectedSources(args.expected, name)
    const valid = citations.filter((citation) => {
      if (citation.grounded === false) return false
      if (sources === undefined) return citation.sourceId !== undefined
      return sources.some((source) => citationMatches(citation, source))
    })
    return { name, score: valid.length / citations.length }
  })
}

function traceFromOutput(output: unknown): TraceLike | undefined {
  if (isRecord(output) && isRecord(output.trace)) return output.trace as TraceLike
  if (isRecord(output) && (Array.isArray(output.steps) || Array.isArray(output.stages))) return output as TraceLike
  return undefined
}

function validStepTrace(step: unknown): boolean {
  return (
    isRecord(step) &&
    typeof step.stepId === 'string' &&
    typeof step.kind === 'string' &&
    (step.status === 'success' || step.status === 'error' || step.status === 'skipped') &&
    typeof step.durationMs === 'number' &&
    Array.isArray(step.warnings)
  )
}

/** Validates the serializable recipe trace shape used for snapshot-style evals. */
export function ragTraceShapeSnapshot<const N extends string = 'rag.traceShapeSnapshot'>(
  opts?: RagMetricOptions<N>,
): Scorer<unknown, unknown, unknown, N> {
  const name = opts?.name ?? ('rag.traceShapeSnapshot' as N)
  return makeCodeScorer(name, (args) => {
    const trace = traceFromOutput(args.output)
    if (trace === undefined)
      return {
        name,
        score: null,
        metadata: { reason: 'output does not contain a trace' },
      }
    const steps = Array.isArray(trace.steps) ? trace.steps : undefined
    const valid =
      typeof trace.id === 'string' &&
      (typeof trace.recipeId === 'string' || typeof trace.retrieverId === 'string') &&
      typeof trace.startedAt === 'number' &&
      typeof trace.durationMs === 'number' &&
      trace.input !== undefined &&
      typeof trace.resultCount === 'number' &&
      steps !== undefined &&
      steps.every(validStepTrace) &&
      Array.isArray(trace.warnings) &&
      Array.isArray(trace.errors)
    return {
      name,
      score: valid ? 1 : 0,
      metadata: valid ? undefined : { reason: 'trace is missing required recipe trace fields' },
    }
  })
}
