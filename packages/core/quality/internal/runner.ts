/**
 * The runner tooling contract — the single entry point the first-party
 * `crux quality` worker (packages/local-workers) uses to drive the engine.
 *
 * This is NOT a public API. It is exported as the `@use-crux/core/quality/internal/runner`
 * subpath solely so the local quality worker can import the engine across the
 * package boundary; it carries no stability guarantees, is excluded from the
 * docs, and may change in any release. Application code must import
 * `@use-crux/core/quality` instead.
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
export {
  baselineRecordPath,
  readBaselineRecord,
  writeBaselineRecord,
  listBaselineRecords,
  buildBaselineReference,
  gitUserName,
} from './baseline'
export type { BaselineRecord } from './baseline'
export { ulid } from './ulid'
export type { Comparison, Experiment, ExperimentCell, RunOverrides } from '../experiment'
export { NotImplementedError } from './errors'
export type { EvaluationDefinition } from './definition'
export {
  createHttpObservabilityTransport,
  currentObservabilityTransport,
  observe,
  setObservabilityTransport,
} from '../../observability'
export type { QualityConfig } from '../config'
