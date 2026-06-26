/**
 * `@use-crux/core/safety` — one deep module for guardrails and constraints.
 *
 * Authoring: `guardrail()`, `constraint()`, evaluated standalone via
 * `evaluateGuardrail()` / `evaluateConstraint()`.
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
export type {
  Guardrail,
  GuardrailConfig,
  GuardrailContext,
  GuardrailPhase,
  GuardrailStreamConfig,
  GuardrailResult,
  InputGuardrailResult,
  OutputGuardrailResult,
  ChunkGuardrailResult,
  GuardrailPass,
  GuardrailBlock,
  GuardrailRedact,
  GuardrailTransform,
  GuardrailWarn,
  GuardrailHold,
  GuardrailAudit,
  GuardrailAuditEntry,
} from './guardrail/types'

// ── Constraint authoring ───────────────────────────────────────────
export { constraint, isConstraint, getConstraintDefinitionSource } from './constraint/define'
export { evaluateConstraint } from './constraint/evaluate'
export { ConstraintViolationError } from './constraint/errors'
export type { ConstraintEvalCase, ConstraintEvalCaseResult, ConstraintEvalReport } from './constraint/evaluate'
export type {
  Constraint,
  ConstraintConfig,
  ConstraintContext,
  ConstraintSeverity,
  ConstraintCheckResult,
  ChunkCheckResult,
  ConstraintOutput,
  ConstraintAudit,
  ConstraintAuditEntry,
  ConstraintFailure,
} from './constraint/types'
