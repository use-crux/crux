// ── Public API ─────────────────────────────────────────────────────
export { constraint, isConstraint, getConstraintDefinitionSource } from './define'
export { runConstraints } from './runner'
export { createConstraintPlugin } from './plugin'
export { evaluateConstraint } from './evaluate'
export { ConstraintViolationError } from './errors'

// ── Types ──────────────────────────────────────────────────────────
export type { ConstraintRunnerOptions, ConstraintRunResult } from './runner'
export type { ConstraintEvalCase, ConstraintEvalCaseResult, ConstraintEvalReport } from './evaluate'
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
} from './types'
