/**
 * LLM-as-a-judge scoring primitives.
 *
 * General-purpose runtime primitives for quality scoring — usable both
 * at runtime (filtering, quality gates) and in testing (eval assertions).
 *
 * `judgeConstraint()` bridges a judge into the safety module's `Constraint`
 * contract for online enforcement; the reverse bridge (`constraintScorer()`)
 * lives in `@crux/core/quality`.
 *
 * @module
 */

export { llmJudge } from './judge'
export { metrics } from './metrics'
export { judgeConstraint } from './judge-constraint'

export type {
  JudgeConfig,
  JudgeResult,
  JudgeInstance,
  JudgeInput,
  JudgeScoreOptions,
  JudgeFewShot,
  MetricDefaults,
} from './types'
export type { JudgeConstraintOptions } from './judge-constraint'
