/**
 * Public request adaptation and warning vocabulary.
 *
 * @module
 */

/** A receipted deviation from a contributor's full exact representation. */
export interface RequestAdaptation {
  /** Safe contributor identity. */
  readonly contributor: string;
  /** Selected representation kind. */
  readonly representation:
    | "authored"
    | "summary"
    | "offload"
    | "omitted";
}

/** Non-fatal warning produced while planning a request. */
export interface RequestWarning {
  /** Stable warning code. */
  readonly code: string;
  /** Redacted warning message. */
  readonly message: string;
}
