/** Stable machine-readable error codes emitted by the evidence API. */
export type CruxEvidenceErrorCode =
  | "EVIDENCE_INPUT_INVALID"
  | "EVIDENCE_SUBJECT_REQUIRED"
  | "EVIDENCE_SUBJECT_NOT_FOUND"
  | "EVIDENCE_KIND_INVALID"
  | "EVIDENCE_CONCLUSION_INVALID"
  | "EVIDENCE_REFERENCE_INVALID"
  | "EVIDENCE_SUPERSESSION_INVALID"
  | "EVIDENCE_IDEMPOTENCY_CONFLICT"
  | "EVIDENCE_WRITE_QUARANTINED"
  | "EVIDENCE_QUERY_UNAVAILABLE"
  | "EVIDENCE_CURSOR_INVALID"
  | "EVIDENCE_ACCESS_DENIED";

const EVIDENCE_ERROR_MARKER = Symbol.for(
  "@use-crux/core/CruxEvidenceError",
);

interface CruxEvidenceErrorOptions {
  readonly code: CruxEvidenceErrorCode;
  readonly whatFailed: string;
  readonly why: string;
  readonly whatStillWorks: string;
  readonly nextStep: string;
}

/**
 * Structured failure from evidence authoring or inspection.
 *
 * @remarks Use {@link CruxEvidenceError.isInstance} across duplicated package
 * copies instead of relying only on `instanceof`.
 */
export class CruxEvidenceError extends Error {
  override readonly name = "CruxEvidenceError";
  /** Stable machine-readable failure code. */
  readonly code: CruxEvidenceErrorCode;
  /** Operation or input that could not be completed. */
  readonly whatFailed: string;
  /** Safe explanation that never echoes payloads or raw keys. */
  readonly why: string;
  /** Behavior or prior state preserved despite the failure. */
  readonly whatStillWorks: string;
  /** Concrete action that can resolve the failure. */
  readonly nextStep: string;
  /** Stable documentation location for evidence diagnostics. */
  readonly docsUrl: string;

  /**
   * Create a safe structured evidence diagnostic.
   *
   * @param options - Safe diagnostic fields prepared by Core.
   */
  constructor(options: CruxEvidenceErrorOptions) {
    super(`${options.whatFailed} ${options.why} ${options.nextStep}`);
    Object.defineProperty(this, EVIDENCE_ERROR_MARKER, { value: true });
    this.code = options.code;
    this.whatFailed = options.whatFailed;
    this.why = options.why;
    this.whatStillWorks = options.whatStillWorks;
    this.nextStep = options.nextStep;
    this.docsUrl = `https://cruxjs.dev/docs/errors/${options.code}`;
    Object.freeze(this);
  }

  /**
   * Recognize evidence errors created by any installed Core copy.
   *
   * @param value - Candidate error value.
   * @returns `true` when the value carries the canonical evidence marker.
   */
  static isInstance(value: unknown): value is CruxEvidenceError {
    return (
      value instanceof CruxEvidenceError ||
      (typeof value === "object" &&
        value !== null &&
        Reflect.get(value, EVIDENCE_ERROR_MARKER) === true)
    );
  }
}

/** Create the missing-subject diagnostic. @internal */
export function evidenceSubjectRequiredError(): CruxEvidenceError {
  return new CruxEvidenceError({
    code: "EVIDENCE_SUBJECT_REQUIRED",
    whatFailed: "Evidence recording could not resolve a subject.",
    why: "No explicit subject or active Crux execution was available.",
    whatStillWorks: "No evidence was recorded or emitted.",
    nextStep:
      "Pass an execution, artifact, or effect-receipt subject explicitly.",
  });
}

/** Create the active-scope query-unavailable diagnostic. @internal */
export function evidenceQueryUnavailableError(): CruxEvidenceError {
  return new CruxEvidenceError({
    code: "EVIDENCE_QUERY_UNAVAILABLE",
    whatFailed: "Evidence inspection has no readable source.",
    why:
      "The active execution has no evidence for this subject and no readable destination is configured.",
    whatStillWorks:
      "Recording and inspection within an active owning scope may still work.",
    nextStep:
      "Inspect before the scope seals or configure a readable observability destination.",
  });
}

/** Create a safe diagnostic for an unreadable configured destination. @internal */
export function evidenceDestinationQueryFailedError(): CruxEvidenceError {
  return new CruxEvidenceError({
    code: "EVIDENCE_QUERY_UNAVAILABLE",
    whatFailed: "Evidence inspection could not read the configured destination.",
    why: "The destination query failed before a valid result was returned.",
    whatStillWorks:
      "Recording and active-scope inspection may still work; no evidence source was mutated.",
    nextStep:
      "Retry the query or inspect the configured destination diagnostics.",
  });
}

/** Create the late-Eval lifecycle rejection diagnostic. @internal */
export function evidenceWriteQuarantinedError(): CruxEvidenceError {
  return new CruxEvidenceError({
    code: "EVIDENCE_WRITE_QUARANTINED",
    whatFailed: "Evidence recording was rejected at the admission gate.",
    why: "The owning Eval cell is closed and quarantines late writes.",
    whatStillWorks:
      "No identifier, sequence, span, collector row, or graph record was created.",
    nextStep:
      "Record evidence before the Eval cell deadline or await the producing task.",
  });
}

/** Create a divergent same-identity diagnostic. @internal */
export function evidenceIdempotencyConflictError(): CruxEvidenceError {
  return new CruxEvidenceError({
    code: "EVIDENCE_IDEMPOTENCY_CONFLICT",
    whatFailed: "Evidence identity reconciliation failed.",
    why:
      "Two visible relationships use the same evidence ID with different immutable metadata.",
    whatStillWorks:
      "Neither source was mutated and no contradictory merged view was returned.",
    nextStep:
      "Use one stable relationship per evidence ID or correct the readable destination.",
  });
}

/** Create a generic invalid-input diagnostic without echoing input. @internal */
export function evidenceInputInvalidError(
  why: string,
  nextStep: string,
): CruxEvidenceError {
  return new CruxEvidenceError({
    code: "EVIDENCE_INPUT_INVALID",
    whatFailed: "Evidence input validation failed.",
    why,
    whatStillWorks: "No evidence was recorded or emitted.",
    nextStep,
  });
}

/** Create a role/conclusion mismatch diagnostic. @internal */
export function evidenceConclusionInvalidError(): CruxEvidenceError {
  return new CruxEvidenceError({
    code: "EVIDENCE_CONCLUSION_INVALID",
    whatFailed: "Evidence conclusion validation failed.",
    why: "The conclusion is not valid for the selected evidence role.",
    whatStillWorks: "No evidence was recorded or emitted.",
    nextStep:
      "Remove the conclusion or use one documented for the selected role.",
  });
}

/** Create an invalid or unresolved evidence-kind diagnostic. @internal */
export function evidenceKindInvalidError(why: string): CruxEvidenceError {
  return new CruxEvidenceError({
    code: "EVIDENCE_KIND_INVALID",
    whatFailed: "Evidence kind validation failed.",
    why,
    whatStillWorks: "The source remains untouched and no evidence was emitted.",
    nextStep:
      "Use a valid custom.* inline kind or pass an explicit valid kind for a reference.",
  });
}

/** Create an invalid evidence cursor diagnostic. @internal */
export function evidenceCursorInvalidError(): CruxEvidenceError {
  return new CruxEvidenceError({
    code: "EVIDENCE_CURSOR_INVALID",
    whatFailed: "Evidence cursor validation failed.",
    why: "The cursor is empty, oversized, or incompatible with this query.",
    whatStillWorks: "No evidence source was queried or mutated.",
    nextStep:
      "Use the opaque cursor returned for this subject, role, and history mode.",
  });
}

/** Create a malformed subject or source-reference diagnostic. @internal */
export function evidenceReferenceInvalidError(
  why = "The subject or source does not have a valid canonical reference shape.",
): CruxEvidenceError {
  return new CruxEvidenceError({
    code: "EVIDENCE_REFERENCE_INVALID",
    whatFailed: "Evidence reference validation failed.",
    why,
    whatStillWorks: "No evidence was recorded or emitted.",
    nextStep:
      "Pass a valid execution, artifact, or bounded effect-receipt reference.",
  });
}

/** Create an invalid supersession diagnostic. @internal */
export function evidenceSupersessionInvalidError(
  why: string,
): CruxEvidenceError {
  return new CruxEvidenceError({
    code: "EVIDENCE_SUPERSESSION_INVALID",
    whatFailed: "Evidence supersession validation failed.",
    why,
    whatStillWorks: "Prior evidence remains active and no new evidence was emitted.",
    nextStep:
      "Use unique evidence refs from the same subject and role.",
  });
}
