/**
 * Scorers — autoevals-compatible scoring functions and the built-in library.
 *
 * Any `({ input, output, expected }) => Score` function is a scorer; autoevals
 * scorers plug in unchanged. Crux built-ins additionally carry a literal
 * `scorerName` (linking gate keys at compile time) and a `costClass` so the
 * reporter can show what costs tokens.
 *
 * Code-class scorers (`exact`, `contains`, `regex`, `levenshtein`,
 * `jsonValid`, `jsonDiff`) are fully implemented. Model-backed scorers
 * (`judge`, `embeddingSimilarity`, `rag.*`) and the retrieval metrics ship
 * with the scorer-library phase — their factories are callable and fully
 * typed now, but invoking the returned scorer throws until then.
 *
 * @module
 */

import { canonicalJson } from './internal/json'
import { notImplemented } from './internal/errors'
import type { ModelRef } from './target'

// ─────────────────────────────────────────────────────────────────
// Core contracts
// ─────────────────────────────────────────────────────────────────

/** What every scorer receives for one executed cell. */
export interface ScorerArgs<I, O, E> {
  input: I
  output: O
  expected: E | undefined
}

/**
 * Autoevals-compatible scoring result. `label` covers categorical/text
 * scorers; judge rationale lives in `metadata`.
 */
export interface Score {
  name: string
  /** 0–1, or `null` when the scorer was skipped / not applicable. */
  score: number | null
  /** Categorical outcome for classification-style scorers. */
  label?: string
  /** Free-form diagnostics; judge rationale lives here. */
  metadata?: Record<string, unknown>
}

/**
 * A scoring function. Any `({ input, output, expected }) => Score` works —
 * autoevals plugs in unchanged. `scorerName` is present on Crux built-ins and
 * enables literal gate-name linkage; `costClass` drives cost display.
 *
 * @typeParam I - Case input type.
 * @typeParam O - Task output type.
 * @typeParam E - Expected payload type.
 * @typeParam N - Literal score name (degrades to `string` for plain fns).
 */
export type Scorer<I, O, E, N extends string = string> = ((args: ScorerArgs<I, O, E>) => Score | Promise<Score>) & {
  /** Present on Crux built-ins; enables literal gate-name linkage + cost display. */
  scorerName?: N
  /** `'code'` runs locally for free; `'model'` spends tokens. */
  costClass?: 'code' | 'model'
}

/**
 * The factory-lambda spelling of `scorers:` — receives the built-in library
 * pre-bound to the evaluation's generics, so `judge.select` is typed
 * `(output: TOutput) => string` contextually. Taught for structured outputs;
 * the plain array stays the documented default.
 *
 * @example
 * ```ts
 * evaluate({
 *   task: supportPrompt, // structured output
 *   data: cases,
 *   scorers: (s) => [s.judge({ name: 'helpful', rubric: '…', select: (o) => o.answer })],
 * })
 * ```
 */
export type ScorerFactory<I, O, E> = (s: BoundScorerLib<I, O, E>) => ReadonlyArray<Scorer<I, O, E, string>>

// ─────────────────────────────────────────────────────────────────
// Built-in option shapes
// ─────────────────────────────────────────────────────────────────

/**
 * Embedding function bridge for `embeddingSimilarity`: maps texts to vectors.
 * Defaults to the project config's embedding provider when omitted.
 */
export type EmbedFn = (texts: readonly string[]) => Promise<ReadonlyArray<ReadonlyArray<number>>>

/** Options shared by the judge-backed RAG scorers. */
export interface JudgeBacked {
  /** Score name override. */
  name?: string
  /** Judge model. Default: project config `quality.setup().judgeModel`. */
  model?: ModelRef
  /** Chain-of-thought before verdict. Default true. */
  useCoT?: boolean
}

/** The non-conditional half of `scorers.judge()` options. */
export interface JudgeOptionsBase<N extends string> {
  /** Score name — flows into gate keys as a literal type. */
  name: N
  /** Free-rubric grading (0–1). Mutually exclusive with `choiceScores`. */
  rubric?: string
  /** Classification with mapped scores. Mutually exclusive with `rubric`. */
  choiceScores?: Record<string, number>
  /** Judge model. Default: project config `quality.setup().judgeModel`. */
  model?: ModelRef
  /** Chain-of-thought before verdict. Default true. Rationale → metadata. */
  useCoT?: boolean
}

/**
 * The `select` requirement: optional for string outputs, REQUIRED for
 * structured outputs (a judge needs text — without a typed selector,
 * structured-output evaluations using text judges are a compile error, not
 * silently stringified JSON). @internal
 */
export type JudgeSelect<O> = [O] extends [string]
  ? { select?: (output: O) => string }
  : { select: (output: O) => string }

// ─────────────────────────────────────────────────────────────────
// Library interfaces (standalone + evaluation-bound)
// ─────────────────────────────────────────────────────────────────

/**
 * The built-in scorer library, generics unbound (standalone import form).
 * `judge` defaults its output type to `string`; for structured outputs,
 * either annotate `select` or use the factory-lambda spelling of `scorers:`
 * to get the pre-bound library.
 */
export interface ScorerLibrary {
  /**
   * LLM-as-judge scorer: free-rubric grading or classification with mapped
   * scores. Chain-of-thought is on by default; the rationale is recorded in
   * the score's `metadata`.
   *
   * @example
   * ```ts
   * scorers.judge({ name: 'helpful', rubric: 'Does the answer resolve the question?' })
   * scorers.judge({ name: 'tone', choiceScores: { formal: 1, casual: 0.5, rude: 0 } })
   * ```
   */
  judge<const N extends string, O = string>(opts: JudgeOptionsBase<N> & JudgeSelect<O>): Scorer<unknown, O, unknown, N>

  /**
   * Exact match against `expected` (canonical-JSON equality for structured
   * values). Returns `null` when the case has no `expected`.
   */
  exact<const N extends string = 'exact'>(opts?: { name?: N }): Scorer<unknown, unknown, unknown, N>

  /**
   * Substring presence. The needle is `value` when given, else the case's
   * `expected` (string cases). Returns `null` without a needle.
   */
  contains(opts?: { name?: string; value?: string }): Scorer<unknown, unknown, unknown, string>

  /** Regex test over the output text. */
  regex(opts: { name?: string; pattern: RegExp }): Scorer<unknown, unknown, unknown, string>

  /**
   * Normalized Levenshtein similarity (0–1) between string output and string
   * `expected`. Returns `null` for non-string pairs.
   */
  levenshtein(opts?: { name?: string }): Scorer<unknown, unknown, unknown, string>

  /** 1 when the output is valid JSON (string outputs are parsed; structured outputs pass). */
  jsonValid(opts?: { name?: string }): Scorer<unknown, unknown, unknown, string>

  /**
   * Structural JSON similarity (0–1) between output and `expected`: recursive
   * key/element comparison with string-leaf Levenshtein and numeric-distance
   * partial credit. Returns `null` when the case has no `expected`.
   */
  jsonDiff(opts?: { name?: string }): Scorer<unknown, unknown, unknown, string>

  /** Cosine similarity between output and `expected` embeddings. Model-backed. */
  embeddingSimilarity(opts?: { name?: string; embed?: EmbedFn }): Scorer<unknown, unknown, unknown, string>

  /** Judge-backed RAG quality scorers (RAGAS-style). */
  rag: {
    /** Is every claim in the answer supported by the retrieved context? */
    faithfulness(opts?: JudgeBacked): Scorer<unknown, unknown, unknown, string>
    /** Does the answer address the question? */
    answerRelevancy(opts?: JudgeBacked): Scorer<unknown, unknown, unknown, string>
    /** Are the retrieved chunks relevant to the question? */
    contextPrecision(opts?: JudgeBacked): Scorer<unknown, unknown, unknown, string>
    /** Did retrieval surface everything the reference answer needs? */
    contextRecall(opts?: JudgeBacked): Scorer<unknown, unknown, unknown, string>
  }

  /**
   * Pure-code retrieval metrics. Cases must carry an `expected` of shape
   * `{ sources: Array<{ sourceId: string; chunkId?: string }> }` (validated
   * at run time).
   */
  retrieval: {
    /** Fraction of cases with ≥1 expected source in the top k. */
    hitRateAtK(k: number): Scorer<unknown, unknown, unknown, string>
    /** Fraction of expected sources present in the top k. */
    recallAtK(k: number): Scorer<unknown, unknown, unknown, string>
    /** Fraction of the top k that are expected sources. */
    precisionAtK(k: number): Scorer<unknown, unknown, unknown, string>
    /** Mean reciprocal rank of the first expected source. */
    mrr(): Scorer<unknown, unknown, unknown, string>
    /** Normalized discounted cumulative gain at k. */
    ndcg(k?: number): Scorer<unknown, unknown, unknown, string>
  }
}

/**
 * The built-in library pre-bound to an evaluation's generics — what the
 * factory-lambda spelling of `scorers:` receives. Identical runtime object;
 * the binding is purely type-level (`judge.select` becomes
 * `(output: TOutput) => string` contextually).
 *
 * @typeParam I - Case input type.
 * @typeParam O - Task output type.
 * @typeParam E - Expected payload type.
 */
export interface BoundScorerLib<I, O, E> {
  judge<const N extends string>(opts: JudgeOptionsBase<N> & JudgeSelect<O>): Scorer<I, O, E, N>
  exact<const N extends string = 'exact'>(opts?: { name?: N }): Scorer<I, O, E, N>
  contains(opts?: { name?: string; value?: string }): Scorer<I, O, E, string>
  regex(opts: { name?: string; pattern: RegExp }): Scorer<I, O, E, string>
  levenshtein(opts?: { name?: string }): Scorer<I, O, E, string>
  jsonValid(opts?: { name?: string }): Scorer<I, O, E, string>
  jsonDiff(opts?: { name?: string }): Scorer<I, O, E, string>
  embeddingSimilarity(opts?: { name?: string; embed?: EmbedFn }): Scorer<I, O, E, string>
  rag: {
    faithfulness(opts?: JudgeBacked): Scorer<I, O, E, string>
    answerRelevancy(opts?: JudgeBacked): Scorer<I, O, E, string>
    contextPrecision(opts?: JudgeBacked): Scorer<I, O, E, string>
    contextRecall(opts?: JudgeBacked): Scorer<I, O, E, string>
  }
  retrieval: {
    hitRateAtK(k: number): Scorer<I, O, E, string>
    recallAtK(k: number): Scorer<I, O, E, string>
    precisionAtK(k: number): Scorer<I, O, E, string>
    mrr(): Scorer<I, O, E, string>
    ndcg(k?: number): Scorer<I, O, E, string>
  }
}

// ─────────────────────────────────────────────────────────────────
// Implementation helpers
// ─────────────────────────────────────────────────────────────────

type AnyScorerFn = (args: ScorerArgs<unknown, unknown, unknown>) => Score | Promise<Score>

function makeScorer<N extends string>(
  name: N,
  costClass: 'code' | 'model',
  fn: AnyScorerFn,
): Scorer<unknown, unknown, unknown, N> {
  return Object.assign(fn, { scorerName: name, costClass })
}

function stubScorer<N extends string>(name: N, what: string): Scorer<unknown, unknown, unknown, N> {
  return makeScorer(name, 'model', () => notImplemented('phase 5', what))
}

function outputText(output: unknown): string {
  return typeof output === 'string' ? output : canonicalJson(output)
}

/** Two-row Levenshtein distance. @internal exported for engine reuse. */
export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  let current = new Array<number>(b.length + 1)
  for (let i = 1; i <= a.length; i++) {
    current[0] = i
    for (let j = 1; j <= b.length; j++) {
      const substitution = previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, substitution)
    }
    ;[previous, current] = [current, previous]
  }
  return previous[b.length]!
}

function stringSimilarity(a: string, b: string): number {
  const max = Math.max(a.length, b.length)
  if (max === 0) return 1
  return 1 - levenshteinDistance(a, b) / max
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Recursive structural similarity used by `jsonDiff`. @internal */
export function jsonSimilarity(actual: unknown, expected: unknown): number {
  if (actual === expected) return 1
  if (typeof actual === 'number' && typeof expected === 'number') {
    const max = Math.max(Math.abs(actual), Math.abs(expected))
    return max === 0 ? 1 : Math.max(0, 1 - Math.abs(actual - expected) / max)
  }
  if (typeof actual === 'string' && typeof expected === 'string') {
    return stringSimilarity(actual, expected)
  }
  if (Array.isArray(actual) && Array.isArray(expected)) {
    const length = Math.max(actual.length, expected.length)
    if (length === 0) return 1
    let total = 0
    for (let i = 0; i < length; i++) {
      total += i < actual.length && i < expected.length ? jsonSimilarity(actual[i], expected[i]) : 0
    }
    return total / length
  }
  if (isPlainObject(actual) && isPlainObject(expected)) {
    const keys = new Set([...Object.keys(actual), ...Object.keys(expected)])
    if (keys.size === 0) return 1
    let total = 0
    for (const key of keys) {
      total += key in actual && key in expected ? jsonSimilarity(actual[key], expected[key]) : 0
    }
    return total / keys.size
  }
  return 0
}

// ─────────────────────────────────────────────────────────────────
// The library
// ─────────────────────────────────────────────────────────────────

function judgeScorer(opts: JudgeOptionsBase<string> & { select?: (output: never) => string }): AnyScorerFn & {
  scorerName?: string
  costClass?: 'code' | 'model'
} {
  if ((opts.rubric === undefined) === (opts.choiceScores === undefined)) {
    throw new TypeError('scorers.judge(): provide exactly one of `rubric` or `choiceScores`.')
  }
  return stubScorer(opts.name, `scorers.judge('${opts.name}')`)
}

/**
 * The built-in scorer library.
 *
 * Standalone import: generics default to `unknown` and `judge.select`
 * requires an annotated parameter for structured outputs. Via the
 * factory-lambda spelling of `scorers:` the same library arrives pre-bound
 * to the evaluation's types.
 *
 * @example
 * ```ts
 * import { evaluate, scorers } from '@crux/core/quality'
 *
 * evaluate({
 *   task: summaryPrompt,
 *   data: cases,
 *   scorers: [scorers.contains(), scorers.judge({ name: 'tone', rubric: 'Professional tone?' })],
 *   gates: { scores: { tone: { min: 0.8 } } },
 * })
 * ```
 */
export const scorers: ScorerLibrary = {
  judge: judgeScorer as ScorerLibrary['judge'],

  exact(opts) {
    const name = opts?.name ?? ('exact' as NonNullable<typeof opts>['name'] & string)
    return makeScorer(name, 'code', ({ output, expected }) => {
      if (expected === undefined) return { name, score: null }
      return { name, score: canonicalJson(output) === canonicalJson(expected) ? 1 : 0 }
    })
  },

  contains(opts) {
    const name = opts?.name ?? 'contains'
    return makeScorer(name, 'code', ({ output, expected }) => {
      const needle = opts?.value ?? (typeof expected === 'string' ? expected : undefined)
      if (needle === undefined) return { name, score: null }
      return { name, score: outputText(output).includes(needle) ? 1 : 0 }
    })
  },

  regex(opts) {
    const name = opts.name ?? 'regex'
    const pattern = opts.pattern
    return makeScorer(name, 'code', ({ output }) => {
      // Reset lastIndex so global/sticky patterns behave statelessly per cell.
      pattern.lastIndex = 0
      return { name, score: pattern.test(outputText(output)) ? 1 : 0 }
    })
  },

  levenshtein(opts) {
    const name = opts?.name ?? 'levenshtein'
    return makeScorer(name, 'code', ({ output, expected }) => {
      if (typeof output !== 'string' || typeof expected !== 'string') return { name, score: null }
      return { name, score: stringSimilarity(output, expected) }
    })
  },

  jsonValid(opts) {
    const name = opts?.name ?? 'jsonValid'
    return makeScorer(name, 'code', ({ output }) => {
      if (output === undefined) return { name, score: 0 }
      if (typeof output !== 'string') return { name, score: 1 }
      try {
        JSON.parse(output)
        return { name, score: 1 }
      } catch {
        return { name, score: 0 }
      }
    })
  },

  jsonDiff(opts) {
    const name = opts?.name ?? 'jsonDiff'
    return makeScorer(name, 'code', ({ output, expected }) => {
      if (expected === undefined) return { name, score: null }
      const actual = typeof output === 'string' ? tryParse(output) : output
      return { name, score: jsonSimilarity(actual, expected) }
    })
  },

  embeddingSimilarity(opts) {
    return stubScorer(opts?.name ?? 'embeddingSimilarity', 'scorers.embeddingSimilarity()')
  },

  rag: {
    faithfulness: (opts) => stubScorer(opts?.name ?? 'faithfulness', 'scorers.rag.faithfulness()'),
    answerRelevancy: (opts) => stubScorer(opts?.name ?? 'answerRelevancy', 'scorers.rag.answerRelevancy()'),
    contextPrecision: (opts) => stubScorer(opts?.name ?? 'contextPrecision', 'scorers.rag.contextPrecision()'),
    contextRecall: (opts) => stubScorer(opts?.name ?? 'contextRecall', 'scorers.rag.contextRecall()'),
  },

  retrieval: {
    hitRateAtK: (k) => stubScorer(`hitRate@${k}`, 'scorers.retrieval.hitRateAtK()'),
    recallAtK: (k) => stubScorer(`recall@${k}`, 'scorers.retrieval.recallAtK()'),
    precisionAtK: (k) => stubScorer(`precision@${k}`, 'scorers.retrieval.precisionAtK()'),
    mrr: () => stubScorer('mrr', 'scorers.retrieval.mrr()'),
    ndcg: (k) => stubScorer(k === undefined ? 'ndcg' : `ndcg@${k}`, 'scorers.retrieval.ndcg()'),
  },
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/**
 * The library handed to factory-lambda `scorers:` — the same runtime object,
 * re-typed against the evaluation's generics. @internal
 */
export function boundScorerLib<I, O, E>(): BoundScorerLib<I, O, E> {
  return scorers as unknown as BoundScorerLib<I, O, E>
}
