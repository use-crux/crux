/**
 * Internal Quality runner facade.
 *
 * This is NOT a public API. It is exported as the
 * `@use-crux/core/quality/internal/runner` subpath solely so first-party
 * tooling can collect, run, and promote Quality evaluations through one
 * operation-level contract. Application code must import
 * `@use-crux/core/quality` instead.
 *
 * @internal
 * @module
 */

import { collectQualityEvaluations } from './runner-collect'
import { compareQualityExperiments } from './runner-compare'
import { createRunnerFeedback } from './runner-feedback'
import { promoteQualityExperiment } from './runner-promote'
import { runQualityEvaluations } from './runner-run'
import type {
  QualityCompareInput,
  QualityCollectInput,
  QualityPromoteInput,
  QualityRunInput,
  QualityRunner,
  QualityRunnerEnv,
} from './runner-types'

/** Current first-party local worker <-> core runner protocol version. */
export const QUALITY_RUNNER_PROTOCOL = 1

export type {
  QualityCollectedEvaluation,
  QualityCompareInput,
  QualityCollectError,
  QualityCollectInput,
  QualityCollectResult,
  QualityEvaluationHandle,
  QualityEvaluationModule,
  QualityEventSink,
  QualityPromoteInput,
  QualityPromoteResult,
  QualityPromotedBaseline,
  QualityFeedbackListFilter,
  QualityRunInput,
  QualityRunner,
  QualityRunnerFeedback,
  QualityRunnerEnv,
  QualityRunnerEvent,
  QualityRunResult,
} from './runner-types'
export type { ExperimentDiff, ExperimentRecord } from '../schema-types'
export type { FeedbackInput, FeedbackRecord } from './feedback'
export type { Comparison, Experiment, ExperimentCell, RunOverrides } from '../experiment'
export type { EvaluationManifest } from '../manifest'
export type { QualityConfig } from '../config'

/**
 * Create the first-party Quality runner facade.
 *
 * The returned object is the supported internal tooling boundary for the local
 * worker and devtools. It hides engine definitions, persistence paths,
 * baseline helpers, prompt-test lowering, and observability plumbing behind
 * three operations: collect, run, and promote.
 *
 * @param env - Runner environment shared by all operations.
 * @returns A frozen Quality runner facade.
 *
 * @example
 * ```ts
 * const runner = createQualityRunner({
 *   rootDir,
 *   dir: qualityDir,
 *   qualityId: config.quality?.id,
 *   events: (event) => process.stdout.write(`${JSON.stringify(event)}\n`),
 * })
 *
 * const collected = await runner.collect({ modules, promptCandidates })
 * const result = await runner.run({ evaluations: collected.evaluations, ids })
 * ```
 */
export function createQualityRunner(env: QualityRunnerEnv = {}): QualityRunner {
  return Object.freeze({
    collect: (input: QualityCollectInput) => collectQualityEvaluations(input, env.events),
    run: (input: QualityRunInput) => runQualityEvaluations(env, input),
    promote: (input: QualityPromoteInput) => promoteQualityExperiment(env, input),
    compare: (input: QualityCompareInput) => compareQualityExperiments(input),
    feedback: createRunnerFeedback(env),
  })
}
