/**
 *
 * Internal error helpers for Eval execution.
 *
 * @internal Eval engine plumbing only.
 * @module
 */

import type { ProjectModelDiagnosticCode } from '../../../project-index'

/** Stable diagnostic codes for Eval definition failures. @internal */
export type EvalDefinitionDiagnosticCode = ProjectModelDiagnosticCode | 'corrupt-baseline' | 'invalid-score'

/**
 * Missing explicit model, judge, or embedding binding for a token-spending
 * Eval path. Tooling promotes this to a definition diagnostic instead of a
 * per-cell failure because the author must wire the eval before it can run.
 *
 * @internal
 */
export class MissingEvalModelBindingError extends Error {
  /** Stable diagnostic code shared with the Project Model. */
  readonly code: ProjectModelDiagnosticCode = 'project_model.model_executor_missing'

  constructor(message: string) {
    super(message)
    this.name = 'MissingEvalModelBindingError'
  }
}

/**
 * A committed baseline exists but cannot be trusted.
 *
 * Baselines are release artifacts. A malformed, unreadable, or wrong-version
 * baseline must fail loudly instead of looking like a first run with no
 * baseline.
 *
 * @internal
 */
export class CorruptBaselineError extends Error {
  readonly code: EvalDefinitionDiagnosticCode = 'corrupt-baseline'

  constructor(path: string, reason: string) {
    super(`corrupt committed baseline at ${path}: ${reason}`)
    this.name = 'CorruptBaselineError'
  }
}
