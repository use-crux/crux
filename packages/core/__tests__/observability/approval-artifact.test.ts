import fixture from "../../src/evidence/fixtures/approval-occurrence-v1.json";
import {
  approvalArtifactAttributes,
  approvalArtifactId,
  isApprovalId,
} from "../../src/observability/approval-artifact";
import {
  CruxArtifactRecordSchema,
  type CruxArtifactRecord,
} from "../../src/observability";
import { describe, expect, it } from "vitest";

describe("approval artifact V1", () => {
  it("matches the shared Unicode grammar and full SHA-256 identity fixture", () => {
    expect(fixture.bounds).toEqual({
      prefix: "approval_",
      maximumScalars: 512,
      maximumUtf8Bytes: 2_048,
    });
    for (const testCase of fixture.approvalIdCases) {
      expect(isApprovalId(testCase.value), JSON.stringify(testCase)).toBe(
        testCase.valid,
      );
    }
    expect(isApprovalId("approval_\ud800")).toBe(false);
    const attributes = approvalArtifactAttributes(
      fixture.marker.approvalOccurrence,
    );
    expect(approvalArtifactId(attributes)).toBe(fixture.expectedArtifactId);
  });

  it("checks scalar and UTF-8 byte bounds independently", () => {
    expect(isApprovalId(`approval_${"a".repeat(503)}`)).toBe(true);
    expect(isApprovalId(`approval_${"a".repeat(504)}`)).toBe(false);
    expect(isApprovalId(`approval_${"😀".repeat(503)}`)).toBe(true);
    expect(isApprovalId(`approval_${"😀".repeat(504)}`)).toBe(false);
  });

  it("requires exact request and decision marker pairings", () => {
    const request = approvalRecord("approval.request", "request");
    const decision = approvalRecord("approval.decision", "decision");

    expect(CruxArtifactRecordSchema.safeParse(request).success).toBe(true);
    expect(CruxArtifactRecordSchema.safeParse(decision).success).toBe(true);
    expect(
      CruxArtifactRecordSchema.safeParse({
        ...request,
        kind: "approval.decision",
      }).success,
    ).toBe(false);
    expect(
      CruxArtifactRecordSchema.safeParse({
        ...request,
        runId: "run_other",
      }).success,
    ).toBe(false);
    expect(
      CruxArtifactRecordSchema.safeParse({
        ...request,
        artifactId: "artifact_".padEnd(73, "0"),
      }).success,
    ).toBe(false);
  });
});

function approvalRecord(
  kind: "approval.request" | "approval.decision",
  slot: "request" | "decision",
): CruxArtifactRecord {
  const namespace = {
    operationId: "run_111111111111111111111111",
    runId: "run_222222222222222222222222",
  } as const;
  const attributes = approvalArtifactAttributes({
    domain: "crux.tool.approval",
    identityEpoch: 1,
    namespace,
    approvalId: "approval_call_α",
    slot,
  });
  return {
    schemaVersion: 5,
    recordId: `rec_approval_${slot}`,
    type: "artifact",
    operationId: namespace.operationId,
    runId: namespace.runId,
    segmentId: `seg_approval_${slot}`,
    segmentSeq: 1,
    traceId: "11111111111111111111111111111111",
    spanId: "1111111111111111",
    artifactId: approvalArtifactId(attributes),
    kind,
    createdAt: "2026-07-30T00:00:00.000Z",
    contentType: "application/json",
    encoding: "json",
    preview: { phase: slot },
    attributes,
  };
}
