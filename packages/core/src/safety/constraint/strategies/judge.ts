/**
 * Judge-backed constraint strategy for online Safety enforcement.
 *
 * @module
 */

import type { GenerateObjectFn } from '../../../compaction/types'
import type { BoundaryDef } from '../../boundary'
import type { ConstraintRun, ConstraintCheckResult } from '../types'
import type { JudgeInstance, JudgeResult } from '../../../scoring/types'

type TextOutputBoundary = BoundaryDef<'model.output.text', string>

export interface JudgeConstraintVerdict<TDetail = unknown> {
  /** The judge's metric id. */
  readonly metricId: string
  /** The judge's clamped score for this check. */
  readonly score: number
  /** The threshold the constraint enforced. */
  readonly minScore: number
  /** Short judge explanation safe to use as retry feedback. */
  readonly explanation: string
  /** Structured details when the judge was configured with `detailSchema`. */
  readonly detail?: TDetail
}

export interface JudgeConstraintStrategyOptions<TDetail = unknown> {
  /** Judge instance from `@use-crux/core/scoring`. */
  readonly judge: JudgeInstance<TDetail>
  /** Minimum acceptable score on the judge's own scale, inclusive. */
  readonly minScore: number
  /** Optional feedback override for failed checks. */
  readonly feedback?: string | ((result: JudgeResult<TDetail>) => string)
  /** Generate-function override for the judge call. */
  readonly generate?: GenerateObjectFn
  /** Model override for the judge call. */
  readonly model?: unknown
  /** Optional input text supplied to the judge alongside the output. */
  readonly input?: string | ((subject: string) => string)
}

/** Create a judge-backed retryable constraint strategy. */
export function judge<TDetail = unknown>(
  options: JudgeConstraintStrategyOptions<TDetail>,
): ConstraintRun<TextOutputBoundary> {
  const run = async (subject: string): Promise<ConstraintCheckResult> => {
    const result = await options.judge.score(
      {
        input: typeof options.input === 'function' ? options.input(subject) : options.input ?? '',
        output: subject,
      },
      {
        ...(options.generate ? { generate: options.generate } : {}),
        ...(options.model !== undefined ? { model: options.model } : {}),
      },
    )

    const verdict = {
      metricId: result.metricId,
      score: result.score,
      minScore: options.minScore,
      explanation: result.reasoning,
      ...(result.detail !== undefined ? { detail: result.detail } : {}),
    } satisfies JudgeConstraintVerdict<TDetail>
    const metadata = { judge: verdict }

    if (result.score >= options.minScore) return { pass: true, metadata }

    const feedback =
      typeof options.feedback === 'function'
        ? options.feedback(result)
        : options.feedback ??
          (result.reasoning.length > 0
            ? result.reasoning
            : `Judge "${options.judge.id}" scored ${result.score}; the minimum acceptable score is ${options.minScore}.`)

    return { pass: false, feedback, metadata }
  }

  return Object.assign(run, {
    strategy: {
      kind: 'constraint.judge',
      config: { judgeId: options.judge.id, minScore: options.minScore },
    },
  })
}
