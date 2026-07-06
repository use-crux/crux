/**
 * LLM-as-a-judge scoring primitives.
 *
 * General-purpose runtime primitives for quality scoring — usable both
 * at runtime (filtering, quality gates) and in testing (eval assertions).
 *
 * Safety integration is authored through `constraint.judge(...)` from
 * `@use-crux/core/safety`; the reverse bridge (`constraintScorer()`) lives
 * in `@use-crux/core/quality`.
 *
 * @module
 */

export { judge } from './judge'
export { metrics } from './metrics'

export type {
  JudgeConfig,
  JudgeResult,
  JudgeInstance,
  JudgeInput,
  JudgeScoreOptions,
  JudgeFewShot,
  MetricDefaults,
} from './types'
