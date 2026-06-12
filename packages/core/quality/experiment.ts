/**
 * The Experiment — the typed result of running an evaluation.
 *
 * One run produces one Experiment: the full matrix (variants × cases ×
 * trials) with per-cell outputs, scores, and assertion results; SEM-honest
 * aggregates; paired-difference comparisons; and gate verdicts driving exit
 * codes. The persisted JSON form (the Experiment record, written to
 * `.crux/quality/experiments/`) mirrors these shapes field-for-field — the
 * typed view adds the task's input/output generics and the literal score
 * names. (One naming note: the typed view exposes cells as `perCase`; the
 * persisted record names the same array `cases`.)
 *
 * @module
 */

import type { GateResult } from './gates'
import type { ReplayMode } from './replay'

/** Resolved variant-name union: the implicit `'default'` when none declared. @internal */
export type VariantNamesOf<TVariants extends string> = [TVariants] extends [never] ? 'default' : TVariants

/** One recorded score on a cell. */
export interface CellScore {
  name: string
  /** 0–1, or `null` when the scorer skipped this cell. */
  score: number | null
  label?: string
  costClass?: 'code' | 'model'
  /** Judge rationale and other diagnostics. */
  metadata?: Record<string, unknown>
}

/** One recorded assertion failure on a cell. */
export interface CellAssertionFailure {
  /** Which expect callback level failed. */
  level: 'evaluation' | 'case'
  /** Position within the callback, 0-based. */
  index: number
  /** The matcher that failed, e.g. `'toolCalls.toHaveCalledBefore'`. */
  matcher: string
  /** Whether this was an `expect.soft` failure (callback continued). */
  soft: boolean
  /** Human-readable message including expected/actual previews. */
  message: string
  /** Truncated, redacted preview of the expected value. */
  expectedPreview?: string
  /** Truncated, redacted preview of the actual value. */
  actualPreview?: string
  /** `file:line:col` of the assertion call, via sourcemap. */
  sourceRef?: string
}

/**
 * One executed cell: case × variant × trial.
 *
 * @typeParam TInput  - Case input type (from the task).
 * @typeParam TOutput - Task output type.
 */
export interface ExperimentCell<TInput = unknown, TOutput = unknown> {
  /** Stable case identity: explicit name slug or content hash. */
  caseId: string
  caseName?: string
  variantName: string
  /** 0-based trial index. */
  trial: number
  status: 'passed' | 'failed' | 'errored' | 'skipped'
  skipReason?: string
  /** Redaction-applied input snapshot. */
  input: TInput
  /** Redaction-applied output snapshot (absent when execution errored). */
  output?: TOutput
  expected?: unknown
  scores: ReadonlyArray<CellScore>
  /** Lowered expect results (evaluation-level + case-level merged, ordered). */
  assertions: {
    ran: number
    /** Assertions after a hard failure that never executed. */
    notEvaluated: number
    failures: ReadonlyArray<CellAssertionFailure>
  }
  error?: {
    message: string
    phase: 'execute' | 'expect' | 'score' | 'replay' | 'timeout'
    /** Set for replay-strict misses: the missing cassette key. */
    missingCassetteKey?: string
  }
  durationMs: number
  costUsd?: number
  usage?: { inputTokens: number; outputTokens: number }
  /** Devtools trace run(s) this cell produced — the failure → trace deep link. */
  traceIds: readonly string[]
  /** Which signal families were actually captured (drives honest-fail diagnostics). */
  capturedSignals: readonly string[]
}

/** Mean + standard error of the mean for one score. SEM is always reported. */
export interface ScoreAggregate {
  mean: number
  sem: number
  n: number
}

/**
 * Per-variant aggregates over all cells.
 *
 * @typeParam TNames - The evaluation's score-name union (scorers + `'pass'`).
 */
export interface VariantAggregate<TNames extends string = string> {
  cells: number
  passed: number
  failed: number
  errored: number
  skipped: number
  /** passed / (cells − skipped). */
  passRate: number
  /** Aggregates keyed by score name — mean + SEM, always. */
  scores: Record<TNames, ScoreAggregate>
  /** Per-case trial aggregations; present when trials > 1. */
  consistency?: {
    /** Fraction of cases with ≥1 passing trial. */
    passAtK: number
    /** Fraction of cases with ALL trials passing (pass^k). */
    passAllTrials: number
  }
  latency: { meanMs: number; p95Ms: number }
  costUsd?: number
}

/** One paired-difference delta: (candidate variant, score name). */
export interface ComparisonDelta<TNames extends string = string> {
  variantName: string
  /** Includes the lowered `'pass'` score. */
  scoreName: TNames
  /** Candidate − baseline, paired per case (trials averaged first). */
  meanDelta: number
  sem: number
  /** Matched case count. */
  n: number
}

/**
 * Question-level paired comparison against the baseline (variant or promoted).
 *
 * @typeParam TNames - The evaluation's score-name union.
 */
export interface Comparison<TNames extends string = string> {
  /** `'variant'` (baseline names a variant in this run) or `'promoted'`. */
  kind: 'variant' | 'promoted'
  /** Variant name or promoted experiment id. */
  baseline: string
  deltas: ReadonlyArray<ComparisonDelta<TNames>>
  /** Cases present on only one side — excluded from paired stats, listed for honesty. */
  unmatchedCases: { baselineOnly: readonly string[]; candidateOnly: readonly string[] }
}

/**
 * Programmatic filters for `evaluation.run()` — the one-line Vitest bridge.
 *
 * Filtered runs (`cases`/`variants` subsets) demote gates and baseline
 * comparison to informational: paired statistics are only honest over
 * matched case populations.
 *
 * @typeParam TVariants - The evaluation's declared variant names.
 */
export interface RunOverrides<TVariants extends string = never> {
  /** Run only these variants. */
  variants?: readonly TVariants[]
  /** Run only these cases (names/ids; glob `*` allowed). */
  cases?: readonly string[]
  /** Override the evaluation's trials. */
  trials?: number
  /** Override the replay mode. */
  replayMode?: ReplayMode
  /** Re-score cached outputs without executing the task (judge iteration). */
  reuseOutputs?: boolean
  /** Abort the run. */
  signal?: AbortSignal
  /** Override execution concurrency. */
  concurrency?: number
}

/**
 * The typed result of one evaluation run.
 *
 * @typeParam TInput    - Case input type (from the task).
 * @typeParam TOutput   - Task output type.
 * @typeParam TNames    - Score-name union (scorer names + `'pass'`).
 * @typeParam TVariants - Declared variant names (`never` → implicit `'default'`).
 *
 * @example
 * ```ts
 * const experiment = await evaluation.run()
 * if (!experiment.passed) {
 *   for (const cell of experiment.perCase.filter((c) => c.status !== 'passed')) {
 *     console.log(cell.caseId, cell.assertions.failures, cell.traceIds)
 *   }
 * }
 * ```
 */
export interface Experiment<TInput = unknown, TOutput = unknown, TNames extends string = string, TVariants extends string = never> {
  schemaVersion: 1
  /** ULID — sortable by creation time. */
  experimentId: string
  /** Resolved evaluation id (explicit or path-derived). */
  evaluationId: string
  /** Workbench id from project config. */
  qualityId: string
  /** Optional grouping label (CLI `--experiment <label>`). */
  experimentLabel?: string
  startedAt: string
  endedAt: string
  /** Hash of the normalized definition — same fingerprint ⇒ comparable results. */
  configFingerprint: string
  /** Hash of the task itself; keys the watch-mode output cache. */
  taskFingerprint: string
  /** True when --case/--variant filters ran a subset (gates informational). */
  filteredRun: boolean
  replay: { mode: ReplayMode; cassette?: string }
  /** Reference this run was compared against, if any. */
  baselineRef?: { baselineId: string; experimentId: string; variantName?: string }
  variants: ReadonlyArray<{
    name: VariantNamesOf<TVariants>
    /** Override KEYS only (values included best-effort when serializable). */
    overrideKeys: readonly string[]
    overrides?: Record<string, unknown>
  }>
  /** One entry per cell: case × variant × trial. (Persisted as `cases`.) */
  perCase: ReadonlyArray<ExperimentCell<TInput, TOutput>>
  aggregates: { perVariant: Record<VariantNamesOf<TVariants>, VariantAggregate<TNames>> }
  /** Present when variants > 1 or a promoted baseline was compared. */
  comparison?: Comparison<TNames>
  gates: {
    /** Overall verdict driving the exit code (false-safe: errored cells fail). */
    passed: boolean
    /** True when gates were not evaluated as blocking (filtered run). */
    informational: boolean
    results: ReadonlyArray<GateResult>
  }
  /** Convenience: `gates.passed && no errored cells`. */
  passed: boolean
  /**
   * Promote this experiment to the committed baseline
   * (`.crux/quality/baselines/`). Requires an explicit evaluation id —
   * promotion on a path-derived id prints the one-line id pin instead of
   * rewriting code. Refused for filtered runs.
   */
  promote(opts?: { id?: string }): Promise<{ baselineId: string }>
}
