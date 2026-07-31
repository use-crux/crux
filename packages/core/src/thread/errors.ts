/**
 * Stable failures for Thread operations.
 *
 * Error codes let applications distinguish invalid history from unavailable
 * durability without parsing provider or adapter messages.
 *
 * @module
 */

/** Stable machine-readable Thread failure codes. */
export type ThreadErrorCode =
  | "commit_failed"
  | "identity_conflict"
  | "in_use"
  | "not_found"
  | "redacted"
  | "invalid_group"
  | "invalid_message"
  | "unsupported_capability"
  | "deleted";

/** Additional context retained by a {@link ThreadError}. */
export interface ThreadErrorOptions {
  readonly cause?: unknown;
}

/** Base class for all typed Thread failures. */
export class ThreadError extends Error {
  readonly code: ThreadErrorCode;
  override readonly cause?: unknown;

  constructor(
    code: ThreadErrorCode,
    message?: string,
    options?: ThreadErrorOptions,
  ) {
    super(message ?? code);
    this.name = "ThreadError";
    this.code = code;
    this.cause = options?.cause;
  }
}

/** Publication failed without a successful Thread receipt. */
export class ThreadCommitError extends ThreadError {
  constructor(message = "The Thread commit could not be published.", cause?: unknown) {
    super("commit_failed", message, { cause });
    this.name = "ThreadCommitError";
  }
}

/** Deletion was rejected because durable owners still reference the Thread. */
export class ThreadInUseError extends ThreadError {
  constructor(message: string, cause?: unknown) {
    super("in_use", message, { cause });
    this.name = "ThreadInUseError";
  }
}
