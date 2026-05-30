/**
 * LLM-as-a-judge scoring primitives.
 *
 * General-purpose runtime primitives for quality scoring — usable both
 * at runtime (filtering, quality gates) and in testing (eval assertions).
 *
 * @module
 */

export { llmJudge } from './judge'
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
