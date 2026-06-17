/**
 * Internal error helpers for the Quality engine.
 *
 * @internal Not exported from `@crux/core/quality` — engine plumbing only.
 * @module
 */

import type { ProjectModelDiagnosticCode } from '../../project-index'

/**
 * Thrown by surfaces whose runtime arrives in a later implementation phase
 * (e.g. `evaluation.run()` before the execution engine exists, model-backed
 * scorers before the judge runtime exists).
 *
 * @internal
 */
export class NotImplementedError extends Error {
  /** The implementation phase that delivers this surface. */
  readonly phase: string

  constructor(phase: string, what: string) {
    super(`${what} is not implemented yet — it arrives in ${phase} of the Quality implementation.`)
    this.name = 'NotImplementedError'
    this.phase = phase
  }
}

/**
 * Missing explicit model, judge, or embedding binding for a token-spending
 * Quality path. Tooling promotes this to a definition diagnostic instead of a
 * per-cell failure because the author must wire the eval before it can run.
 *
 * @internal
 */
export class MissingQualityModelBindingError extends Error {
  /** Stable diagnostic code shared with the Project Model. */
  readonly code: ProjectModelDiagnosticCode = 'project_model.model_executor_missing'

  constructor(message: string) {
    super(message)
    this.name = 'MissingQualityModelBindingError'
  }
}

/**
 * Throw a {@link NotImplementedError} for a surface that lands in a later phase.
 *
 * @internal
 */
export function notImplemented(phase: string, what: string): never {
  throw new NotImplementedError(phase, what)
}
