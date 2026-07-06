/**
 * Shared types for LLM-as-a-judge scoring primitives.
 *
 * @module
 */

import type { z } from 'zod'
import type { GenerateObjectFn } from '../compaction/types'

// ── Judge Configuration ─────────────────────────────────────────────

/** Few-shot calibration example for a judge. */
export interface JudgeFewShot {
  input: string
  output: string
  score: number
  reasoning: string
}

/** Configuration for creating an LLM judge via `judge()`. */
export interface JudgeConfig<TDetail = unknown> {
  /** Unique identifier for this judge/metric. */
  id: string
  /** What the judge evaluates — used as the core system prompt instruction. */
  criteria: string
  /** Scoring scale boundaries. */
  scale: { min: number; max: number }
  /** Optional rubric mapping scores to descriptions. */
  rubric?: Record<number, string>
  /**
   * Dynamic context injected alongside criteria in the system prompt.
   * Use this for per-call context like brand profiles, style guides, etc.
   */
  context?: string
  /** Whether to request a concise explanation before scoring. Default: true. */
  chainOfThought?: boolean
  /** Few-shot calibration examples. */
  fewShot?: JudgeFewShot[]
  /** Default model (overridable per score() call). */
  model?: unknown
  /** Default generate function (overridable per score() call). */
  generate?: GenerateObjectFn
  /**
   * Optional Zod schema for structured details alongside the score.
   * When provided, the judge output includes a `detail` field matching this schema.
   * Use for domain-specific structured output (e.g., `{ issues: string[], aligned: boolean }`).
   */
  detailSchema?: z.ZodType<TDetail>
}

// ── Judge Result ────────────────────────────────────────────────────

/** Result from a judge scoring operation. */
export interface JudgeResult<TDetail = unknown> {
  /** Numeric score within the judge's scale. */
  score: number
  /** Short explanation for the score. */
  reasoning: string
  /** ID of the judge/metric that produced this result. */
  metricId: string
  /** Structured details when judge was configured with `detailSchema`. */
  detail?: TDetail
}

// ── Judge Instance ──────────────────────────────────────────────────

/** Input to a judge's score() method. */
export interface JudgeInput {
  /** The input/query/prompt that was given. */
  input: string
  /** The output/response to evaluate. */
  output: string
  /** Optional reference/ground-truth answer for comparison. */
  reference?: string
}

/** Override options for a single score() call. */
export interface JudgeScoreOptions {
  model?: unknown
  generate?: GenerateObjectFn
  /** Eval run ID — threaded to devtools instrumentation for event correlation. */
  evalId?: string
}

/** A reusable LLM judge instance. */
export interface JudgeInstance<TDetail = unknown> {
  /** The judge's unique ID. */
  id: string
  /** Score an input/output pair against this judge's criteria. */
  score(input: JudgeInput, options?: JudgeScoreOptions): Promise<JudgeResult<TDetail>>
}

// ── Metric Defaults ─────────────────────────────────────────────────

/** Default model and generate function for pre-built metric judges. */
export interface MetricDefaults {
  generate: GenerateObjectFn
  model: unknown
}
