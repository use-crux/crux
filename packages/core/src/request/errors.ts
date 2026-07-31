/**
 * Typed, redacted failures raised while composing provider requests.
 *
 * @module
 */

/** Stable reason codes for pre-dispatch request composition failures. */
export type RequestCompositionErrorCode =
  | "REQUEST_TOO_LARGE"
  | "REPRESENTATION_UNAVAILABLE"
  | "INVALID_COMPOSITION";

/**
 * Redacted evidence explaining one request composition decision or failure.
 *
 * Diagnostics identify contribution classes and token counts, never authored
 * content.
 */
export interface RequestDiagnostic {
  /** Stable identity unique within the request composition attempt. */
  readonly id: string;
  /** Stable machine-readable diagnostic code. */
  readonly code: string;
  /** Safe contribution class, such as `messages` or `tools`. */
  readonly contributor?: string;
  /** Canonical history ownership when the diagnostic concerns history. */
  readonly source?: "caller-messages" | "thread";
  /** Measured tokens attributed to the contribution class. */
  readonly tokens?: number;
  /** Redacted, actionable explanation. */
  readonly message: string;
}

/**
 * A request could not be composed without violating authored policy.
 *
 * The error is raised before provider dispatch. Its diagnostics are safe to
 * serialize and never contain prompt, message, Tool, or schema content.
 *
 * @example
 * ```ts
 * try {
 *   await runtime.generate(reply, options);
 * } catch (error) {
 *   if (error instanceof RequestCompositionError) {
 *     console.error(error.code, error.diagnostics);
 *   }
 * }
 * ```
 */
export class RequestCompositionError extends Error {
  /** Identity of the request composition attempt that failed. */
  readonly requestId: string;
  /** Stable request-composition failure code. */
  readonly code: RequestCompositionErrorCode;
  /** Redacted evidence and remedies for the failure. */
  readonly diagnostics: readonly RequestDiagnostic[];

  /**
   * Create a typed request-composition failure.
   *
   * @param code - Stable failure code.
   * @param message - Redacted human-readable summary.
   * @param diagnostics - Redacted structured evidence.
   * @param requestId - Identity of the failed composition attempt.
   */
  constructor(
    code: RequestCompositionErrorCode,
    message: string,
    diagnostics: readonly RequestDiagnostic[],
    requestId: string,
  ) {
    super(message);
    this.name = "RequestCompositionError";
    this.requestId = requestId;
    this.code = code;
    this.diagnostics = Object.freeze([...diagnostics]);
  }
}
