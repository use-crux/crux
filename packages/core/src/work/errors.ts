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

/** Stable machine-readable code for Work admission rejections. */
export type WorkAdmissionErrorCode =
  | "work_admission_max_outstanding"
  | "work_admission_max_active"
  | "work_admission_max_depth"
  | "work_admission_max_starts";

/** Provider-neutral category for a Work admission rejection. */
export type WorkAdmissionCategory = "capacity" | "topology" | "lifetime";

/** Discriminated reason describing why a Work occurrence was rejected. */
export type WorkAdmissionReason =
  | { code: "work_admission_max_outstanding" }
  | { code: "work_admission_max_active" }
  | { code: "work_admission_max_depth" }
  | { code: "work_admission_max_starts" };

/** Immutable per-code admission metadata: retryability, category, and message. */
interface WorkAdmissionDefinition {
  readonly code: WorkAdmissionErrorCode;
  readonly retryable: boolean;
  readonly category: WorkAdmissionCategory;
  readonly message: string;
}

/**
 * Frozen map of admission codes to their stable, provider-neutral definitions.
 * Callers branch on `code` (or `category`) without inspecting any provider.
 */
const WORK_ADMISSION_DEFINITIONS: Readonly<
  Record<WorkAdmissionErrorCode, WorkAdmissionDefinition>
> = Object.freeze({
  work_admission_max_outstanding: Object.freeze({
    code: "work_admission_max_outstanding",
    retryable: true,
    category: "capacity",
    message:
      "Work admission rejected: the per-owner outstanding limit is reached.",
  }),
  work_admission_max_active: Object.freeze({
    code: "work_admission_max_active",
    retryable: true,
    category: "capacity",
    message: "Work admission rejected: the per-owner active limit is reached.",
  }),
  work_admission_max_depth: Object.freeze({
    code: "work_admission_max_depth",
    retryable: false,
    category: "topology",
    message: "Work admission rejected: the maximum Work depth is reached.",
  }),
  work_admission_max_starts: Object.freeze({
    code: "work_admission_max_starts",
    retryable: false,
    category: "lifetime",
    message:
      "Work admission rejected: the maximum number of starts is reached.",
  }),
});

/**
 * Thrown by `spawn()` when the active policy rejects a Work occurrence before
 * acceptance.
 *
 * The constructor accepts a discriminated reason keyed on `code`. With no
 * argument it defaults to the `work_admission_max_outstanding` reason,
 * preserving the historical zero-argument constructor.
 *
 * @remarks Retryability depends on the reason: capacity limits (outstanding and
 * active) are retryable because draining below the limit may admit the same
 * occurrence, while topology and lifetime limits (depth and starts) are
 * terminal for the occurrence and must not be retried unchanged.
 */
export class WorkAdmissionError extends WorkError {
  /** Stable machine-readable admission failure code. */
  readonly code: WorkAdmissionErrorCode;
  /** Whether a host may retry this Work occurrence later. */
  readonly retryable: boolean;
  /** Provider-neutral category for this admission rejection. */
  readonly category: WorkAdmissionCategory;

  constructor(
    reason: WorkAdmissionReason = { code: "work_admission_max_outstanding" },
  ) {
    const definition = WORK_ADMISSION_DEFINITIONS[reason.code];
    super(definition.message);
    this.code = definition.code;
    this.retryable = definition.retryable;
    this.category = definition.category;
  }
}
