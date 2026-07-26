// ── Authoring API (execution goes through the Safety session — see ../session) ──
export { constraint, isConstraint, getConstraintDefinitionSource } from './define'
export { evaluateConstraint } from './evaluate'
export { ConstraintViolationError } from './errors'
export type { JudgeConstraintStrategyOptions, JudgeConstraintVerdict } from './strategies'

// ── Types ──────────────────────────────────────────────────────────
export type { ConstraintEvalCase, ConstraintEvalCaseResult, ConstraintEvalReport } from './evaluate'
export type {
  Constraint,
  ConstraintConfig,
  ConstraintContext,
  ConstraintSeverity,
  ConstraintCheckResult,
  ConstraintOutput,
  ConstraintAudit,
  ConstraintAuditEntry,
  ConstraintFailure,
} from './types'
export { validateConstraintRunResult } from './types'
