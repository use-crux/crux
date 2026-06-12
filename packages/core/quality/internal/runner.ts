/**
 * The runner tooling contract — the single entry point the first-party
 * `crux quality` worker (packages/devtools) uses to drive the engine.
 *
 * This is NOT a public API. It is exported as the `@crux/core/quality/internal/runner`
 * subpath solely so the devtools worker can import the engine across the
 * package boundary; it carries no stability guarantees, is excluded from the
 * docs, and may change in any release. Application code must import
 * `@crux/core/quality/api` instead.
 *
 * @internal
 * @module
 */

export { runEvaluation, QualityDefinitionError } from './engine'
export type { EngineOptions, EngineSetup } from './engine'
export { getEvaluationDefinition, EVALUATION_INTERNAL } from '../evaluate'
export type { Evaluation } from '../evaluate'
export { lowerPromptTests, hasPromptTests } from './prompt-tests'
export { buildManifest, resolveCaseId } from '../manifest'
export type { EvaluationManifest } from '../manifest'
export { toExperimentRecord, persistExperiment, experimentRecordPath } from './persist'
export type { Experiment, ExperimentCell, RunOverrides } from '../experiment'
export { NotImplementedError } from './errors'
export type { EvaluationDefinition } from './definition'
export type { QualityConfig, QualitySetupResult } from '../config'
