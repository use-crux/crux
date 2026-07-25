/**
 * Stable typed failures for the structured readiness scanner.
 *
 * @module
 */

/** Machine-stable scanner failure codes. */
export type StructuredScanErrorCode =
  | 'invalid-json'
  | 'duplicate-key'
  | 'depth-limit'
  | 'byte-limit'
  | 'incomplete'
  | 'trailing-content'

/**
 * A structured readiness scan failed. The scanner never repairs or guesses, so a
 * failure means the provider output is not valid, complete JSON within limits.
 * Messages carry structural facts (position, depth, sizes, key names) — never a
 * transformation of held/sensitive content beyond the offending key.
 */
export class StructuredScanError extends Error {
  override readonly name = 'StructuredScanError'
  readonly code: StructuredScanErrorCode

  constructor(code: StructuredScanErrorCode, message: string) {
    super(message)
    this.code = code
  }
}
