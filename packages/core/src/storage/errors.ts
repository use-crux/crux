/**
 * Typed errors for Storage Beta contract failures.
 *
 * @module
 */

/** Stable machine-readable failure codes used by storage adapters. */
export type StorageErrorCode =
  | 'not_found'
  | 'conflict'
  | 'unsupported_capability'
  | 'invalid_key'
  | 'invalid_value'
  | 'invalid_filter'
  | 'ttl_unsupported'
  | 'backend_error'

/** Additional context for a {@link StorageError}. */
export interface StorageErrorOptions {
  /** Original backend or provider error, when one exists. */
  readonly cause?: unknown
}

/** Error class for storage API contract and adapter failures. */
export class StorageError extends Error {
  /** Stable error code for programmatic handling. */
  readonly code: StorageErrorCode

  /** Original backend or provider error, when one exists. */
  override readonly cause?: unknown

  constructor(code: StorageErrorCode, message?: string, options?: StorageErrorOptions) {
    super(message ?? code)
    this.name = 'StorageError'
    this.code = code
    this.cause = options?.cause
  }
}
