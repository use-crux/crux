/**
 * TypeScript types for Quality machine-readable JSON contracts.
 *
 * These types back the `@use-crux/core/quality/schemas` subpath. They are kept
 * separate from the schema values so schema construction stays focused.
 *
 * @module
 */

import type { Experiment } from './experiment'
import type { GateResult } from './gates'

/** Persisted Experiment record shape, without the runtime `promote()` method. */
export type ExperimentRecord = Omit<Experiment<unknown, unknown, string, string>, 'promote'>

/** Machine-readable experiment-to-experiment diff. */
export interface ExperimentDiff {
  schemaVersion: 1
  a: { experimentId: string }
  b: { experimentId: string }
  comparable: boolean
  fingerprintDrift: readonly string[]
  scores: readonly ExperimentDiffScore[]
  cases: readonly ExperimentDiffCase[]
  onlyInA: readonly string[]
  onlyInB: readonly string[]
  gatesVerdict: { aPassed: boolean; bPassed: boolean }
}

/** Aggregate score delta in an experiment diff. */
export interface ExperimentDiffScore {
  name: string
  aMean: number
  bMean: number
  delta: number
  sem: number
  significant: boolean
}

/** One matched case+variant row in an experiment diff. */
export interface ExperimentDiffCase {
  caseId: string
  variant: string
  aPassed: boolean
  bPassed: boolean
  scoreDeltas: Record<string, number>
}

/** JSON summary object emitted by `crux quality run --json`. */
export interface RunSummary {
  schemaVersion: 1
  runId: string
  passed: boolean
  exitCode: 0 | 1 | 2
  evaluations: readonly RunSummaryEvaluation[]
  summary?: string
}

/** One evaluation entry in a run summary. */
export interface RunSummaryEvaluation {
  id: string
  experimentId?: string
  recordPath?: string
  passed: boolean
  gates: readonly GateResult[]
  cells: { total: number; passed: number; failed: number; errored: number; skipped: number }
  failures: readonly RunSummaryFailure[]
  cost?: { totalUsd?: number }
  durationMs?: number
}

/** One compact failure entry in a run summary. */
export interface RunSummaryFailure {
  caseId: string
  variant: string
  trial: number
  phase: string
  summary: string
  evidence: { recordPath?: string; cellEvidenceCommand?: string }
}

/** JSON report emitted by `crux quality judge-report --json`. */
export interface JudgeReport {
  schemaVersion: 1
  evaluationId: string
  scorers: readonly JudgeReportScorer[]
}

/** Per-scorer judge-vs-human agreement stats. */
export interface JudgeReportScorer {
  name: string
  threshold: number
  labeled: number
  confusion: { tp: number; fp: number; fn: number; tn: number }
  agreement: number
  precision: number | null
  recall: number | null
  kappa: number | null
  disagreements: readonly JudgeReportDisagreement[]
}

/** One judge-vs-human disagreement. */
export interface JudgeReportDisagreement {
  experimentId: string
  caseId: string
  variant: string
  trial: number
  human: 'pass' | 'fail'
  judgeScore: number | null
  rationale?: string
}
