/**
 * Judge → constraint bridge.
 *
 * `judgeConstraint()` turns any LLM judge into a perfectly ordinary
 * {@link Constraint}, so a single quality definition (brand voice,
 * groundedness, tone) written once as a judge can be enforced online through
 * the safety session — retries, audits, and observability all work unchanged.
 * The judge's chain-of-thought `reasoning` becomes the regeneration feedback,
 * which is exactly what a corrective message wants to be.
 *
 * This is a factory, not a new primitive — the same composition pattern as
 * `citationConstraint()` in `@crux/core/citations`. For the reverse bridge
 * (regression-testing a production constraint in the eval suite), see
 * `constraintScorer()` in `@crux/core/quality`.
 *
 * @module
 */

import type { z } from 'zod'
import { constraint } from '../safety/constraint'
import type { Constraint, ConstraintContext, ConstraintOutput, ConstraintSeverity } from '../safety/constraint'
import type { GenerateObjectFn } from '../compaction/types'
import type { JudgeInstance, JudgeResult } from './types'

/**
 * The judge verdict attached as `metadata.judge` to every check result a
 * judge constraint produces — and therefore to the corresponding
 * `ConstraintAuditEntry.metadata`. Use it to read scores back out of safety
 * audits without re-deriving the shape.
 *
 * @example
 * ```ts
 * const entry = safety.audit.constraints?.entries.find((e) => e.constraint === 'brand-voice')
 * const verdict = entry?.metadata?.judge as JudgeConstraintVerdict | undefined
 * verdict?.score // the judge's clamped score for that attempt
 * ```
 */
export interface JudgeConstraintVerdict<TDetail = unknown> {
  /** The judge's `id`. */
  readonly metricId: string
  /** The judge's clamped score for this check. */
  readonly score: number
  /** The threshold the constraint enforced. */
  readonly min: number
  /** The judge's chain-of-thought reasoning. */
  readonly reasoning: string
  /** Structured details when the judge was configured with `detailSchema`. */
  readonly detail?: TDetail
}

/** Options for {@link judgeConstraint}. */
export interface JudgeConstraintOptions<TDetail = unknown, TSchema extends z.ZodType = z.ZodType<unknown>> {
  /**
   * Minimum acceptable score on the judge's own scale (inclusive).
   * `score >= min` passes; anything below fails and drives a retry.
   */
  readonly min: number
  /**
   * Constraint severity — `'assert'` (default) hard-fails after retries are
   * exhausted, `'suggest'` is best-effort. Passed through to `constraint()`.
   */
  readonly severity?: ConstraintSeverity
  /** Per-constraint retry budget. Passed through to `constraint()` (default 2). */
  readonly maxRetries?: number
  /**
   * Optional risk-category label (e.g. `'brand'`, `'grounding'`) carried
   * through audit entries and observability artifacts.
   */
  readonly category?: string
  /**
   * Feedback for the corrective retry message. Defaults to the judge's
   * `reasoning` (falling back to a generic score-below-minimum message when
   * the judge returned empty reasoning).
   */
  readonly feedback?: (result: JudgeResult<TDetail>) => string
  /**
   * Generate-function override for the judge call in production. Useful when
   * the judge was authored for CI with an eval-suite `generate` and the
   * online path uses a different binding.
   */
  readonly generate?: GenerateObjectFn
  /** Model override for the judge call in production. */
  readonly model?: unknown
  /**
   * Derive the judge's `input` field from the output under check. Constraint
   * checks only see the generated output, not the original prompt — by
   * default the judge receives an empty `input` and evaluates the output on
   * its own terms. Provide this when the judge's criteria genuinely need the
   * input (e.g. read it from `ctx.metadata`).
   *
   * Annotating the parameter as `ConstraintOutput<typeof mySchema>` threads
   * the schema onto the returned `Constraint<TSchema>` so `output.parsed`
   * is typed instead of `unknown` — the same generic `constraint()` and
   * `citationConstraint()` take.
   */
  readonly input?: (output: ConstraintOutput<TSchema>, ctx: ConstraintContext) => string
}

/**
 * Bridge an LLM judge into a normal {@link Constraint} for online
 * enforcement of scored quality.
 *
 * The returned constraint is indistinguishable from a hand-written one: the
 * safety session runs it in the standard parallel-check/combined-retry loop,
 * audit entries carry the judge's score in `metadata.judge`, and
 * `severity`/`maxRetries` behave exactly as on `constraint()`.
 *
 * On each check the judge scores the output text; `score >= min` passes.
 * On failure the judge's reasoning (or your `feedback` override) becomes the
 * corrective feedback for the regeneration round.
 *
 * @example
 * ```ts
 * import { llmJudge, judgeConstraint } from '@crux/core/scoring'
 *
 * const brandVoice = llmJudge({
 *   id: 'brand-voice',
 *   criteria: 'Does the copy match the warm, direct Karyla brand voice?',
 *   scale: { min: 1, max: 10 },
 * })
 *
 * // CI: score it over an eval dataset.   Production: enforce it.
 * const brandVoiceGate = judgeConstraint(brandVoice, {
 *   min: 7,
 *   severity: 'assert',
 *   generate: productionGenerate,
 *   model: 'gpt-5-mini',
 * })
 * // → pass brandVoiceGate anywhere a Constraint is accepted
 * ```
 *
 * @param judge - Any `JudgeInstance` from `llmJudge()` or the pre-built metrics.
 * @param opts - Threshold plus standard constraint knobs — see {@link JudgeConstraintOptions}.
 * @returns A frozen `Constraint` named after the judge's `id`.
 */
export function judgeConstraint<TDetail = unknown, TSchema extends z.ZodType = z.ZodType<unknown>>(
  judge: JudgeInstance<TDetail>,
  opts: JudgeConstraintOptions<TDetail, TSchema>,
): Constraint<TSchema> {
  return constraint<TSchema>({
    name: judge.id,
    category: opts.category,
    severity: opts.severity,
    maxRetries: opts.maxRetries,
    check: async (output, ctx) => {
      const result = await judge.score(
        { input: opts.input?.(output, ctx) ?? '', output: output.text },
        {
          ...(opts.generate ? { generate: opts.generate } : {}),
          ...(opts.model !== undefined ? { model: opts.model } : {}),
        },
      )

      const verdict = {
        metricId: result.metricId,
        score: result.score,
        min: opts.min,
        reasoning: result.reasoning,
        ...(result.detail !== undefined ? { detail: result.detail } : {}),
      } satisfies JudgeConstraintVerdict<TDetail>
      const metadata = { judge: verdict }

      if (result.score >= opts.min) {
        return { pass: true, metadata }
      }

      const feedback =
        opts.feedback?.(result) ??
        (result.reasoning.length > 0
          ? result.reasoning
          : `Judge "${judge.id}" scored ${result.score}; the minimum acceptable score is ${opts.min}.`)

      return { pass: false, feedback, metadata }
    },
  })
}
