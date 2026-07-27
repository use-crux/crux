/**
 * `@use-crux/core/safety` — runtime safety boundary engine.
 *
 * Authoring: attach `guardrail()`, `constraint()`, and action policies to
 * typed `boundary.*` targets. Testing helpers evaluate authored policies
 * without exposing session internals.
 *
 * Consumption: one per-call session created with `createSafety()` —
 * `guardInput()` → `finalizeOutput()` → `stamp()`, plus `openStream()` for
 * streamed runs. Global registration goes through `createSafetyPlugin()`.
 *
 * Orchestration internals (scope merging, the guardrail pipeline, the
 * constraint retry runner, corrective-feedback phrasing, the stream
 * transform) are private to the session.
 *
 * @module
 */

// ── Boundary and shared decision types ─────────────────────────────
export { boundary, isBoundaryDef, isMediaSafetyTargetId } from './boundary'
export type {
  BoundaryDef,
  BoundaryIdOf,
  BoundaryInput,
  DotPath,
  HoldLimits,
  ItemsBoundary,
  LineOptions,
  MediaPart,
  MediaPartLocation,
  MediaPartOrigin,
  MediaPartSubject,
  MediaSafetyTargetId,
  ObjectBoundary,
  OriginOf,
  PathBoundary,
  PathValue,
  SafetyTargetId,
  SafetyUnitKind,
  SegmentOptions,
  SentenceOptions,
  StringPathSentencesBoundary,
  SubjectOf,
  TextBoundary,
} from './boundary'
export type {
  InputBoundaryOptions,
  InputSource,
  MediaInputSource,
  ModelInputOrigin,
  TextInputSource,
} from './input-origin'
export type {
  SafetyCaptureSummary,
  SafetyDecision,
  SafetyDecisionAction,
  SafetyEffectivePolicyOptions,
  SafetyFinding,
  SafetyRunContext,
  StrategyRun,
} from './decision'
export type { SafetyTuneOptions, SafetyTunePolicyOptions } from './tune'
export type { SafetyAudit } from './audit'

// ── Policy-terminal errors ────────────────────────────────────────
export {
  SafetyConfigError,
  SafetyConvergenceError,
  SafetyResultError,
  SafetyStructuredSyncError,
  StreamHoldLimitError,
  isPolicyTerminal,
} from './errors'

// ── The per-call session ───────────────────────────────────────────
export { createSafety, defaultConstraintFeedbackFormatter } from './session'
export type {
  Safety,
  SafetyCallOptions,
  SafetyContext,
  SafetyOutput,
  SafetyProtocolEvent,
  SafetyStream,
  SafetyStreamDirective,
  SafetyStreamSeal,
  ConstraintFeedbackFormatter,
} from './session'

// ── Plugin registration ────────────────────────────────────────────
export { createSafetyPlugin } from './plugin'
export type { SafetyPolicy } from './plugin'

// ── Guardrail authoring ────────────────────────────────────────────
export { guardrail, isGuardrail, getGuardrailDefinitionSource } from './guardrail/define'
export { evaluateGuardrail } from './guardrail/evaluate'
export { GuardrailBlockedError } from './guardrail/errors'
export { MEDIA_CLASSIFIER_PROMPT_VERSION } from './guardrail/strategies'
export type {
  Guardrail,
  GuardrailConfig,
  GuardrailMode,
  GuardrailRunResult,
  GuardrailRewriteKind,
  MediaGuardrailRunResult,
} from './guardrail/types'
export type {
  MediaClassifierAction,
  MediaClassifierCategory,
  MediaClassifierModality,
  MediaClassifierOptions,
  MediaClassifierUnsupportedAction,
  MediaGuardrailAction,
  MediaGuardrailOptions,
  MediaSizeGuardrailRule,
  MediaSourceGuardrailRule,
  MediaTypeGuardrailRule,
  MediaTypePattern,
} from './guardrail/strategies'

// ── Constraint authoring ───────────────────────────────────────────
export { constraint, isConstraint, getConstraintDefinitionSource } from './constraint/define'
export { evaluateConstraint } from './constraint/evaluate'
export { ConstraintViolationError } from './constraint/errors'
export type { ConstraintEvalCase, ConstraintEvalCaseResult, ConstraintEvalReport } from './constraint/evaluate'
export type {
  Constraint,
  ConstraintConfig,
  ConstraintSeverity,
  ConstraintCheckResult,
} from './constraint/types'
export type { JudgeConstraintStrategyOptions, JudgeConstraintVerdict } from './constraint/strategies'

// ── Tool/action policy authoring ──────────────────────────────────
export { toolPolicy } from './toolPolicy'
export type {
  ToolPolicyAction,
  ToolPolicyArgsOptions,
  ToolPolicyApprovalOptions,
  ToolPolicyConfig,
  ToolPolicyMatch,
  ToolPolicyResultOptions,
} from './toolPolicy'
