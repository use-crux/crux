/**
 * Payload-safe public errors for Signal publication.
 *
 * @module
 */

import type { StandardSchemaV1 } from "../internal/standard-schema";

/** Stable domain code for a Signal publication failure. */
export type SignalErrorCode =
  | "invalid_payload"
  | "idempotency_conflict"
  | "publication_rejected";

/** Base error for Signal validation and publication failures. */
export class SignalError extends Error {
  /** Stable machine-readable failure code. */
  readonly code: SignalErrorCode;

  /** Create a payload-safe Signal error. */
  constructor(code: SignalErrorCode, message: string) {
    super(message);
    this.name = "SignalError";
    this.code = code;
  }
}

/** Error returned when an authored payload fails its Signal schema. */
export class SignalValidationError extends SignalError {
  /** Standard Schema issues without the rejected payload value. */
  readonly issues: readonly StandardSchemaV1.Issue[];

  /** Create a validation error from Standard Schema issues. */
  constructor(issues: readonly StandardSchemaV1.Issue[]) {
    super("invalid_payload", "Signal payload failed schema validation.");
    this.name = "SignalValidationError";
    this.issues = Object.freeze(issues.slice(0, 20).map(safeValidationIssue));
  }
}

function safeValidationIssue(
  issue: StandardSchemaV1.Issue,
): StandardSchemaV1.Issue {
  return Object.freeze({
    message: "Signal payload did not satisfy the schema.",
    ...(issue.path === undefined
      ? {}
      : {
          path: Object.freeze(
            issue.path.slice(0, 20).map((segment) =>
              typeof segment === "object" && segment !== null
                ? Object.freeze({ key: segment.key })
                : segment,
            ),
          ),
        }),
  });
}
