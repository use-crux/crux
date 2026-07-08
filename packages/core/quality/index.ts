/**
 * `@use-crux/core/quality` — the Quality public surface, curated exports only.
 *
 * Five values: `evaluate`, `target`, `scorers`, `dataset`, `cassette`.
 * Everything else is types. The internal engine (normalization, matrix
 * execution, statistics, persistence) lives under `quality/internal/` and is
 * never exported. First-party tooling uses the separate `@internal`
 * `@use-crux/core/quality/internal/runner` facade (no stability guarantees).
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
