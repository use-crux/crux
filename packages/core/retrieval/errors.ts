/**
 * Retrieval beta error helpers.
 *
 * @module
 */

/** Thrown by public Retrieval beta surfaces whose runtime lands in a later phase. */
export class RetrievalNotImplementedError extends Error {
  /** Implementation phase that owns this runtime behavior. */
  readonly phase: string

  constructor(phase: string, what: string) {
    super(`${what} is not implemented yet; it arrives in ${phase}.`)
    this.name = 'RetrievalNotImplementedError'
    this.phase = phase
  }
}

/** Throw a phase-scoped not-implemented error. */
export function retrievalNotImplemented(phase: string, what: string): never {
  throw new RetrievalNotImplementedError(phase, what)
}
