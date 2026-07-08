/**
 * The Experiment — the typed result of running an evaluation.
 *
 * One run produces one Experiment: the full matrix (variants × cases ×
 * trials) with per-cell outputs, scores, and assertion results; SEM-honest
 * aggregates; paired-difference comparisons; and gate verdicts driving exit
 * codes. The persisted JSON form (the Experiment record, written to
 * `.crux/quality/experiments/`) mirrors these shapes field-for-field — the
 * typed view adds the task's input/output generics and the literal score
 * names. (One naming note: the typed view exposes cells as `cells`; the
 * persisted record names the same array `cases`.)
 *
 * @module
 */

import type { GateResult } from './gates'
import type { ReplayMode } from './replay'
import type { QualitySourceFrame } from './source-frame'
import type { TokenUsage } from '../generation/types'

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

/**
 * Execution phase that produced an assertion outcome.
 *
 * `expect` outcomes come from the pre-score `ctx.expect` callback.
 * `afterScores` outcomes come from the score-aware post-score assertion phase.
 */
export type CellAssertionPhase = 'expect' | 'afterScores'

/**
 * Status of one assertion outcome.
 *
 * - `passed`: matcher ran and succeeded.
 * - `failed`: matcher ran and failed.
 * - `not-evaluated`: a prior hard failure stopped the callback before this
 *   matcher could execute.
 * - `uncaptured`: the assertion targeted a trace signal that this cell did
 *   not capture, such as `ctx.expect.toolCalls` on a plain function task.
 */
export type CellAssertionStatus = 'passed' | 'failed' | 'not-evaluated' | 'uncaptured'

/**
 * Structured value captured at an assertion boundary.
 *
 * The `preview` is the compact display string used by CLI, TUI, and devtools
 * surfaces. `value` is the JSON-safe snapshot retained for deeper inspection.
 * `redacted` is `true` when the stored value has already passed through the
 * Quality redaction rules.
 */
export interface CellAssertionValue {
  /** Human label for the side of the comparison, for example `actual`. */
  label: string
  /** JSON-safe value snapshot. */
  value: unknown
  /** Bounded display representation of `value`. */
  preview: string
  /** Whether the value was redacted before it was recorded. */
  redacted: boolean
}

/** Operator captured for a structured assertion expression. */
export type CellAssertionExpressionOperator = '>=' | '>' | '<=' | '<' | '==' | '!=' | 'contains' | 'matches' | 'custom'

/**
 * Structured expression evaluated by an assertion matcher.
 *
 * This is the backend-owned truth statement used by later evidence read
 * models to render score thresholds such as `0.58 >= 0.7 => false` without
 * parsing human failure messages.
 */
export interface CellAssertionExpression {
  /** Left-hand value observed by the matcher. */
  left: CellAssertionValue
  /** Normalized operator for the matcher. */
  operator: CellAssertionExpressionOperator
  /** Right-hand value or threshold, when the matcher has one. */
  right?: CellAssertionValue
  /** Whether the expression passed after matcher semantics were applied. */
  result: boolean
  /** Compact display string shared by CLI, TUI, and devtools surfaces. */
  rendered: string
}

/**
 * One entry in a cell's ordered assertion ledger.
 *
 * Outcomes are emitted through `ExperimentCell.assertions.outcomes` in the
 * order a human reads the authored callback. They intentionally include
 * passing assertions and not-evaluated placeholders, so debug surfaces can
 * explain both where the callback stopped and which earlier checks succeeded.
 *
 * @example
 * ```ts
 * const failed = cell.assertions.outcomes?.find((outcome) => outcome.status === 'failed')
 * console.log(failed?.matcher, failed?.actual?.preview, failed?.sourceRef)
 * ```
 */
export interface CellAssertionOutcome {
  /** Stable per-cell outcome id: `${phase}:${level}:${index}`. */
  id: string
  /** Whether the outcome came from the evaluation-level or case-level callback. */
  level: 'evaluation' | 'case'
  /** Assertion phase that produced this outcome. */
  phase: CellAssertionPhase
  /** Position within the merged assertion ledger, 0-based. */
  index: number
  /** Result of evaluating, skipping, or failing to capture this assertion. */
  status: CellAssertionStatus
  /** Matcher name, such as `toBe` or `toolCalls.toHaveCalled`. */
  matcher: string
  /** Whether this outcome came from `ctx.expect.soft`. */
  soft: boolean
  /** Human-readable matcher message, when the assertion runtime exposes one. */
  message?: string
  /**
   * Authored source text passed to `ctx.expect(...)` or `ctx.expect.soft(...)`.
   *
   * This is resolved from the narrow source-frame snapshot, so it is present only
   * when first-party tooling can map the runtime stack frame back to authored
   * source.
   */
  subjectExpr?: string
  /** Captured actual value, when the matcher exposes one. */
  actual?: CellAssertionValue
  /** Captured expected value or threshold, when the matcher exposes one. */
  expected?: CellAssertionValue
  /** Structured expression for matchers with comparable actual/expected values. */
  expression?: CellAssertionExpression
  /** Best-effort `file:line:column` of the authored assertion call. */
  sourceRef?: string
  /** Stable catalog assertion-site id when runtime/catalog matching succeeds. */
  assertionSiteId?: string
  /**
   * Observability span IDs that directly produced the signal evidence used by
   * this outcome. Present only when the matcher can point at concrete trace
   * spans instead of an output-only or aggregate comparison.
   */
  spanIds?: readonly string[]
  /** Authored source-frame snapshot, or an honest unavailable result. */
  sourceFrame?: QualitySourceFrame
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
  /**
   * Lowered assertion results for this cell.
   */
  assertions: {
    /** Assertions that executed in the real callback pass. */
    ran: number
    /** Assertions after a hard failure that never executed. */
    notEvaluated: number
    /** Ordered assertion ledger. Includes passed, failed, uncaptured, and not-evaluated assertions. */
    outcomes: ReadonlyArray<CellAssertionOutcome>
  }
  error?: {
    message: string
    phase: 'execute' | 'expect' | 'afterScores' | 'score' | 'replay' | 'timeout'
    /** Set for replay-strict misses: the missing cassette key. */
    missingCassetteKey?: string
    /** Best-effort `file:line:column` for callback/task crashes. */
    sourceRef?: string
    /** Authored frame for callback/task crashes, when the runner can resolve it. */
    sourceFrame?: QualitySourceFrame
  }
  durationMs: number
  costUsd?: number
  usage?: TokenUsage
  /** Devtools trace run(s) this cell produced — the failure → trace deep link. */
  traceIds: readonly string[]
  /** Which signal families were actually captured (drives honest-fail diagnostics). */
  capturedSignals: readonly string[]
  /**
   * Cell diagnostics. `truncated: true` when the output snapshot hit the
   * 32 KiB limit (the full output lives in the trace store via `traceIds`).
   */
  metadata?: Record<string, unknown>
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
  /**
   * Present when the comparison is informational rather than blocking: the
   * promoted baseline's `configFingerprint` no longer matches this run
   * (cases or definition changed since promotion). Deltas are still computed
   * over the matched cases, but gates reading them cannot block.
   */
  demoted?: { reason: string }
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
 *   for (const cell of experiment.cells.filter((c) => c.status !== 'passed')) {
 *     console.log(cell.caseId, cell.assertions.outcomes, cell.traceIds)
 *   }
 * }
 * ```
 */
export interface Experiment<
  TInput = unknown,
  TOutput = unknown,
  TNames extends string = string,
  TVariants extends string = never,
> {
  schemaVersion: 2
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
  /** Observability run identity for the evaluation umbrella trace. */
  observability?: { runId: string; traceId: string }
  /** True when --case/--variant filters ran a subset (gates informational). */
  filteredRun: boolean
  replay: {
    mode: ReplayMode
    cassette?: string
    /** True when declared trials > 1 collapsed to 1 under replay-strict. */
    trialsCollapsed?: true
    /** Cassette `recordedAt` when it exceeded the 90-day staleness window. */
    staleSince?: string
  }
  /** Reference this run was compared against, if any. */
  baselineRef?: { baselineId: string; experimentId: string; variantName?: string }
  variants: ReadonlyArray<{
    name: VariantNamesOf<TVariants>
    /** Override KEYS only (values included best-effort when serializable). */
    overrideKeys: readonly string[]
    overrides?: Record<string, unknown>
  }>
  /** One entry per cell: case × variant × trial. */
  cells: ReadonlyArray<ExperimentCell<TInput, TOutput>>
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
   * promotion on a path-derived id errors with the one-line id pin to add
   * (pass `id` to pin programmatically). Refused for filtered runs. With
   * declared variants, pass `variant` to choose which one becomes the
   * reference (defaults to the declared `baseline:` variant).
   *
   * @returns The new baseline id and the path of the committed record.
   */
  promote(opts?: { id?: string; variant?: string }): Promise<{ baselineId: string; path: string }>
}
