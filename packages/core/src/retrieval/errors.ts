/**
 * Retrieval beta error helpers.
 *
 * @module
 */

/** Stable configuration error codes for Retrieval beta public surfaces. */
export type RetrievalConfigErrorCode =
  | 'missing_model'
  | 'recipe_id_conflict'
  | 'reserved_step_id'
  | 'invalid_step_order'
  | 'missing_store_capability'

/** Stable runtime error codes for Retrieval beta public surfaces. */
export type RetrievalRunErrorCode = 'hydration_miss' | 'source_failed' | 'step_failed'

/** Thrown when a retrieval primitive is constructed with an invalid config. */
export class RetrievalConfigError extends Error {
  /** Machine-readable configuration error code. */
  readonly code: RetrievalConfigErrorCode

  constructor(code: RetrievalConfigErrorCode, message: string) {
    super(message)
    this.name = 'RetrievalConfigError'
    this.code = code
  }
}

/** Thrown when a retrieval run fails after a traceable operation starts. */
export class RetrievalRunError extends Error {
  /** Machine-readable runtime error code. */
  readonly code: RetrievalRunErrorCode

  /** Original thrown value, when available. */
  readonly cause?: unknown

  /** Serializable runtime trace captured before surfacing the failure. */
  readonly trace?: unknown

  constructor(code: RetrievalRunErrorCode, message: string, options: { cause?: unknown; trace?: unknown } = {}) {
    super(message)
    this.name = 'RetrievalRunError'
    this.code = code
    if ('cause' in options) {
      this.cause = options.cause
    }
    if ('trace' in options) {
      this.trace = options.trace
    }
  }
}

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
