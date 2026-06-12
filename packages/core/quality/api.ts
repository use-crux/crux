/**
 * The v1 Quality public surface — curated exports only.
 *
 * Five values: `evaluate`, `target`, `scorers`, `dataset`, `cassette`.
 * Everything else is types. The internal engine (normalization, matrix
 * execution, statistics, persistence) lives under `quality/internal/` and is
 * never exported.
 *
 * Transition note: until the legacy quality surface (`quality()`, `suite()`,
 * the old `target`/`cassette`/`expect` exports in `quality/index.ts`) is
 * removed, this new surface lives in this module; the removal phase makes it
 * THE `@crux/core/quality` entry point.
 *
 * @module
 */

// ── Values (exactly five) ─────────────────────────────────────────
export { evaluate } from './evaluate'
export { target } from './target'
export { scorers } from './scorers'
export { dataset } from './dataset'
export { cassette } from './replay'

// ── Types ─────────────────────────────────────────────────────────
export type { Evaluation, EvaluateOptions, EvaluateApi, EvaluateFunction } from './evaluate'
export type { Case, CaseOf, Turn } from './case'
export type { CaseContext, BoundExpect, Matchers, ValueExpect, AlwaysOnExpect, SignalExpect, ArgsMatcher, StepAccess, UncapturedSignalError } from './expect'
export type {
  Target,
  Capability,
  TaskLike,
  PromptParams,
  FlowParams,
  AgentParams,
  RetrieverTargetOptions,
  ToolMocks,
  ModelRef,
  ModelSettings,
  GenerateFn,
  InputOf,
  OutputOf,
  ParamsOf,
  CapsOf,
  ExpectedOf,
} from './target'
export type { Scorer, ScorerArgs, Score, ScorerFactory, BoundScorerLib, EmbedFn, JudgeBacked } from './scorers'
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
  CellAssertionFailure,
} from './experiment'
export type { EvaluationManifest } from './manifest'
export type { StandardSchemaV1 } from './standard-schema'
export type { QualityConfig, QualitySetupResult } from './config'
