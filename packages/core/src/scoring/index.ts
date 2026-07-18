/**
 * LLM-as-a-judge scoring primitives.
 *
 * General-purpose runtime primitives for scoring model output.
 *
 * Safety integration is authored through `constraint.judge(...)` from
 * `@use-crux/core/safety`.
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
