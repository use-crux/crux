/** Stable public diagnostics for request-scoped deferred work. */
export const DEFER_ERROR_CODES = [
  "DEFER_SCOPE_REQUIRED",
  "DEFER_CAPABILITY_MISSING",
  "DEFER_SCOPE_SEALED",
  "DEFER_LIMIT_EXCEEDED",
  "DEFER_REPLAY_UNSAFE",
  "DEFER_TARGET_INPUT_REQUIRED",
  "DEFER_COMMIT_FAILED",
] as const;

/** String-literal discriminant for public defer diagnostics. */
export type CruxDeferErrorCode = (typeof DEFER_ERROR_CODES)[number];

/** Required fields for a public defer diagnostic. */
export interface DeferErrorInput {
  /** Stable code from the defer error catalog. */
  readonly code: CruxDeferErrorCode;
  /** Concise description of the operation that failed. */
  readonly message: string;
  /** Original error preserved across a defer boundary. */
  readonly cause?: unknown;
}

/** Error thrown when deferred work cannot honor its lifecycle contract. */
export class CruxDeferError extends Error {
  /** Stable machine-readable diagnostic code. */
  readonly code: CruxDeferErrorCode;
  /** Canonical documentation URL for this diagnostic. */
  readonly docsUrl: string;

  constructor(input: DeferErrorInput) {
    const docsUrl = `https://cruxjs.dev/docs/errors/${input.code}`;
    super(`${input.message}\n\nCode: ${input.code}\nDocs: ${docsUrl}`, {
      cause: input.cause,
    });
    this.name = "CruxDeferError";
    this.code = input.code;
    this.docsUrl = docsUrl;
  }
}

/** Create a typed public defer diagnostic. */
export function createDeferError(input: DeferErrorInput): CruxDeferError {
  return new CruxDeferError(input);
}
