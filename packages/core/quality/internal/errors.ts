/**
 * Internal error helpers for the Quality engine.
 *
 * @internal Not exported from `@crux/core/quality` — engine plumbing only.
 * @module
 */

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
 * Throw a {@link NotImplementedError} for a surface that lands in a later phase.
 *
 * @internal
 */
export function notImplemented(phase: string, what: string): never {
  throw new NotImplementedError(phase, what)
}
