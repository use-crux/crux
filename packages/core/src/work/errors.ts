/** Typed terminal and lifecycle errors returned by Work methods. */

import type { WorkFailure } from "./status";

/** Base class for typed Work errors. */
class WorkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Thrown by `result()` when Work terminalizes with a safe failure. */
export class WorkFailedError extends WorkError {
  readonly code = "work_failed";
  constructor(
    readonly workId: string,
    readonly failure: WorkFailure,
  ) {
    super(failure.message);
  }
}

/** Thrown by `result()` when Work terminalizes through cancellation. */
export class WorkCancelledError extends WorkError {
  readonly code = "work_cancelled";
  constructor(
    readonly workId: string,
    readonly reason?: string,
  ) {
    super(reason ?? "Work was cancelled.");
  }
}

/** Thrown by `result()` when a completed result is no longer retained. */
export class WorkResultExpiredError extends WorkError {
  readonly code = "work_result_expired";
  constructor(readonly workId: string) {
    super("Work result is no longer retained.");
  }
}

/** Thrown when an operation requiring live Work addresses a terminal occurrence. */
export class WorkNotActiveError extends WorkError {
  readonly code = "work_not_active";
  constructor(readonly workId: string) {
    super("Work is no longer active.");
  }
}
