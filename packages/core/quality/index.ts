/**
 * `@use-crux/core/quality` — the Quality beta public surface.
 *
 * Quality is beta: the authoring surface (`evaluate`, `target`, `scorers`,
 * `dataset`, `cassette`), the experiment/manifest record schemas
 * (`quality/schemas`), CLI JSON outputs, and exit codes are stable within 0.x
 * minors. Breaking changes get a changeset `minor` and a migration note.
 * `quality/internal/runner` remains internal with no guarantees.
 *
 * The five authoring values are `evaluate`, `target`, `scorers`, `dataset`,
 * and `cassette`. `UncapturedSignalError` is exported as a runtime error class
 * for assertion handling; the rest of this module is types.
 *
 * @module
 */

// ── Values (exactly five) ─────────────────────────────────────────
export { evaluate } from './evaluate'
export { target } from './target'
export { scorers } from './scorers'
export { dataset } from './dataset'
export { cassette } from './replay'
export { UncapturedSignalError } from './expect'

// ── Types ─────────────────────────────────────────────────────────
export type { Evaluation, EvaluationCoverageTargetId, EvaluateOptions, EvaluateApi, EvaluateFunction } from './evaluate'
export type { Case, CaseOf, Turn } from './case'
export type {
  CaseContext,
  AssertContext,
  BoundExpect,
  Matchers,
  ScoreMap,
  ValueExpect,
  AlwaysOnExpect,
  SignalExpect,
  ArgsMatcher,
  StepAccess,
  StepAccessor,
} from './expect'
export type {
  TurnDecisionReportContextExpect,
  TurnDecisionReportExpect,
  TurnDecisionReportReasonOptions,
} from './decision-report-expect'
export type {
  Target,
  Capability,
  TaskLike,
  PromptParams,
  FlowParams,
  AgentParams,
  RetrieverTargetOptions,
  RetrievalRecipeTargetOptions,
  ToolMocks,
  ModelRef,
  ModelSettings,
  GenerateFn,
  InputOf,
  OutputOf,
  ParamsOf,
  CapsOf,
} from './target'
export type {
  Scorer,
  ScorerArgs,
  Score,
  ScorerFactory,
  ScorerLibrary,
  BoundScorerLib,
  EmbedFn,
  JudgeBacked,
} from './scorers'
export type { RagContextPrecisionOptions, RagMetricOptions } from './internal/rag-metrics'
export type { Gates, ScoreGate, GateResult } from './gates'
export type { Dataset } from './dataset'
export type { Cassette, ReplayMode, NormalizedCall } from './replay'
export type {
  Experiment,
  ExperimentCell,
  RunOverrides,
  VariantAggregate,
  ScoreAggregate,
  Comparison,
  ComparisonDelta,
  CellScore,
  CellAssertionOutcome,
  CellAssertionPhase,
  CellAssertionStatus,
  CellAssertionValue,
  CellAssertionExpression,
  CellAssertionExpressionOperator,
} from './experiment'
export type {
  QualitySourceFrame,
  QualitySourceFrameLine,
  QualitySourceFrameLineRole,
  QualitySourceFrameRequest,
  QualitySourceFrameResolver,
  QualitySourceFrameResolverKind,
  QualitySourceFrameSnapshot,
  QualitySourceUnavailable,
  QualitySourceUnavailableReason,
} from './source-frame'
export type { EvaluationManifest } from './manifest'
export type { StandardSchemaV1 } from './standard-schema'
export type { QualityConfig } from './config'
