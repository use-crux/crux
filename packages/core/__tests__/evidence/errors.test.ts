import { describe, expect, it } from "vitest";
import {
  CruxEvidenceError,
  type CruxEvidenceErrorCode,
} from "../../src";

const CODES = [
  "EVIDENCE_INPUT_INVALID",
  "EVIDENCE_SUBJECT_REQUIRED",
  "EVIDENCE_SUBJECT_NOT_FOUND",
  "EVIDENCE_KIND_INVALID",
  "EVIDENCE_CONCLUSION_INVALID",
  "EVIDENCE_REFERENCE_INVALID",
  "EVIDENCE_SUPERSESSION_INVALID",
  "EVIDENCE_IDEMPOTENCY_CONFLICT",
  "EVIDENCE_WRITE_QUARANTINED",
  "EVIDENCE_QUERY_UNAVAILABLE",
  "EVIDENCE_CURSOR_INVALID",
  "EVIDENCE_ACCESS_DENIED",
] as const satisfies readonly CruxEvidenceErrorCode[];

describe("CruxEvidenceError", () => {
  it.each(CODES)("provides stable actionable fields for %s", (code) => {
    const error = new CruxEvidenceError({
      code,
      whatFailed: "Evidence operation failed.",
      why: "The supplied value is not valid.",
      whatStillWorks: "Previously accepted evidence remains available.",
      nextStep: "Correct the input and retry.",
    });

    expect(error).toMatchObject({
      name: "CruxEvidenceError",
      code,
      whatFailed: expect.stringMatching(/\S/u),
      why: expect.stringMatching(/\S/u),
      whatStillWorks: expect.stringMatching(/\S/u),
      nextStep: expect.stringMatching(/\S/u),
      docsUrl: `https://cruxjs.dev/docs/errors/${code}`,
    });
    expect(error.message).toContain(error.whatFailed);
    expect(error.message).toContain(error.why);
    expect(error.message).toContain(error.nextStep);
    expect(Object.isFrozen(error)).toBe(true);
    expect(CruxEvidenceError.isInstance(error)).toBe(true);
  });

  it("recognizes a marked error from another package copy", () => {
    const marker = Symbol.for("@use-crux/core/CruxEvidenceError");
    const foreignError = new Error("foreign evidence failure");
    Object.defineProperty(foreignError, marker, { value: true });

    expect(foreignError).not.toBeInstanceOf(CruxEvidenceError);
    expect(CruxEvidenceError.isInstance(foreignError)).toBe(true);
    expect(
      Object.getOwnPropertyDescriptor(foreignError, marker),
    ).toMatchObject({
      enumerable: false,
      value: true,
    });
  });

  it("does not serialize its cross-copy marker or unsafe constructor data", () => {
    const error = new CruxEvidenceError({
      code: "EVIDENCE_INPUT_INVALID",
      whatFailed: "Evidence validation failed.",
      why: "A bounded field is invalid.",
      whatStillWorks: "No evidence was emitted.",
      nextStep: "Use the documented bounded value.",
    });

    expect(JSON.stringify(error)).not.toContain(
      "@use-crux/core/CruxEvidenceError",
    );
    expect(String(error)).not.toContain("PRIVATE-PAYLOAD");
  });
});
