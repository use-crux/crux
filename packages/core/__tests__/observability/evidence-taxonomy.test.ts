import { describe, expect, it } from "vitest";
import {
  CRUX_CANONICAL_ARTIFACT_KINDS,
  CRUX_CANONICAL_EDGE_TYPES,
  CRUX_PRIMITIVE_FAMILIES,
  CRUX_PRIMITIVE_FAMILY_BY_NAME,
  CRUX_PRIMITIVE_NAMES,
  CruxSpanStartRecordSchema,
} from "../../src/observability";
import { ARTIFACT_CAPTURE_DECISIONS } from "../../src/observability/capture-policy-contract";

describe("evidence observability taxonomy", () => {
  it("maps the evidence.record primitive and evidence.for edge canonically", () => {
    expect(CRUX_PRIMITIVE_FAMILIES).toContain("evidence");
    expect(CRUX_PRIMITIVE_NAMES).toContain("evidence.record");
    expect(CRUX_PRIMITIVE_FAMILY_BY_NAME["evidence.record"]).toBe("evidence");
    expect(CRUX_CANONICAL_EDGE_TYPES).toContain("evidence.for");

    expect(
      CruxSpanStartRecordSchema.safeParse({
        schemaVersion: 5,
        recordId: "rec_evidence_taxonomy",
        type: "span:start",
        operationId: "run_evidence_taxonomy",
        runId: "run_evidence_taxonomy",
        segmentId: "seg_evidence_taxonomy",
        segmentSeq: 1,
        spanId: "1111111111111111",
        family: "evidence",
        primitive: "evidence.record",
        name: "record evidence",
        startedAt: "2026-07-28T12:00:00.000Z",
        status: "running",
      }).success,
    ).toBe(true);
  });

  it("classifies approval request and decision artifacts as canonical safety evidence", () => {
    expect(CRUX_CANONICAL_ARTIFACT_KINDS).toEqual(
      expect.arrayContaining(["approval.request", "approval.decision"]),
    );
    expect(ARTIFACT_CAPTURE_DECISIONS["approval.request"]).toBe("safety");
    expect(ARTIFACT_CAPTURE_DECISIONS["approval.decision"]).toBe("safety");
  });
});
