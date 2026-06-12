/**
 * Gates — the declarative pass/fail policy that drives CLI exit codes.
 *
 * Zero-config default (no `gates` declared): **assertions gate, scores
 * inform** — a run is red iff a cell errored or an `expect` failed; scorer
 * values are reported but never block. Declaring any gate REPLACES (not
 * extends) that default policy.
 *
 * @module
 */

/**
 * A floor/ceiling/delta gate over one named score.
 */
export interface ScoreGate {
  /** Minimum acceptable mean score (0–1). */
  min?: number
  /** Maximum acceptable mean score (0–1). */
  max?: number
  /**
   * Minimum paired-difference delta vs the baseline (candidate − baseline,
   * paired per case). Requires a baseline — a `baseline:` variant or a
   * promoted baseline record.
   */
  minDeltaVsBaseline?: number
}

/**
 * The declarative gate set of an evaluation. Gate keys under `scores` are
 * typed by the evaluation's literal scorer names (plus the lowered `pass`
 * score), so gating a scorer that doesn't exist is a compile error.
 *
 * @typeParam N - The union of gateable score names.
 *
 * @example
 * ```ts
 * evaluate({
 *   task: supportPrompt,
 *   data: cases,
 *   scorers: [scorers.judge({ name: 'helpful', rubric: '…' })],
 *   gates: {
 *     passRate: { min: 0.95 },
 *     scores: { helpful: { min: 0.7, minDeltaVsBaseline: -0.02 } },
 *     latency: { p95Ms: 4000 },
 *   },
 * })
 * ```
 */
export interface Gates<N extends string> {
  /** Floor on the pass rate over the lowered `pass` score. */
  passRate?: { min: number }
  /** Per-score gates, keyed by literal scorer names. */
  scores?: Partial<Record<N, ScoreGate>>
  /** Latency ceilings (per-variant aggregates). */
  latency?: { p95Ms?: number; meanMs?: number }
  /** Cost ceilings. */
  cost?: { maxPerCaseUsd?: number; maxTotalUsd?: number }
  /** Consistency gates over trials: pass@k / pass^k floors. */
  consistency?: { passAtK?: number; passAllTrials?: boolean }
}

/**
 * The recorded outcome of one evaluated gate (part of the Experiment record).
 */
export interface GateResult {
  /** Dot-path of the gate, e.g. `'scores.helpful.min'`, `'consistency.passAllTrials'`. */
  gate: string
  /** Gates evaluate per non-baseline variant. */
  variantName?: string
  threshold: number | boolean
  actual: number | boolean
  passed: boolean
}
