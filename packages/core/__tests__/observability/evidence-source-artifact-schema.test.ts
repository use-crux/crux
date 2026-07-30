import { describe, expect, it } from "vitest";
import { CruxArtifactRecordSchema } from "../../src/observability";

const baseArtifact = {
  schemaVersion: 5,
  recordId: "rec_evidence_artifact",
  type: "artifact",
  operationId: "run_evidence",
  runId: "run_evidence",
  segmentId: "seg_evidence",
  segmentSeq: 1,
  artifactId: "artifact_evidence",
  kind: "score.report",
  createdAt: "2026-07-29T12:00:00Z",
  contentType: "application/json",
} as const;

const validReferenceHash = `sha256:${"a".repeat(64)}`;

function evidenceArtifact(
  captureState: "available" | "reference" | "not-captured",
) {
  return {
    ...baseArtifact,
    attributes: {
      evidenceSource: {
        evidenceId: "evidence_1111111111111111",
        captureState,
      },
    },
  };
}

describe("qualified evidence-source artifacts", () => {
  it("accepts the exact state-specific V1 shapes", () => {
    expect(
      CruxArtifactRecordSchema.safeParse({
        ...evidenceArtifact("available"),
        encoding: "json",
        preview: null,
      }).success,
    ).toBe(true);
    expect(
      CruxArtifactRecordSchema.safeParse({
        ...evidenceArtifact("reference"),
        encoding: "reference",
      }).success,
    ).toBe(true);
    expect(
      CruxArtifactRecordSchema.safeParse({
        ...evidenceArtifact("reference"),
        encoding: "reference",
        hash: validReferenceHash,
        sizeBytes: 0,
      }).success,
    ).toBe(true);
    expect(
      CruxArtifactRecordSchema.safeParse({
        ...evidenceArtifact("not-captured"),
        encoding: "reference",
      }).success,
    ).toBe(true);
  });

  it.each([
    ["63 hexadecimal characters", `sha256:${"a".repeat(63)}`],
    ["65 hexadecimal characters", `sha256:${"a".repeat(65)}`],
    ["uppercase hexadecimal", `sha256:${"A".repeat(64)}`],
    ["short digest", "sha256:abc"],
    ["different algorithm", "fnv1a:00000000"],
    ["leading whitespace", ` ${validReferenceHash}`],
    ["trailing whitespace", `${validReferenceHash} `],
    ["non-ASCII", `sha256:${"a".repeat(63)}é`],
  ])("rejects a reference hash with %s", (_name, hash) => {
    expect(
      CruxArtifactRecordSchema.safeParse({
        ...evidenceArtifact("reference"),
        encoding: "reference",
        hash,
      }).success,
    ).toBe(false);
  });

  it.each([
    ["missing marker state", { evidenceId: "evidence_1111111111111111" }],
    [
      "unknown marker field",
      {
        evidenceId: "evidence_1111111111111111",
        captureState: "available",
        private: true,
      },
    ],
    [
      "redacted marker state",
      {
        evidenceId: "evidence_1111111111111111",
        captureState: "redacted",
      },
    ],
  ])("rejects %s", (_name, marker) => {
    expect(
      CruxArtifactRecordSchema.safeParse({
        ...evidenceArtifact("available"),
        encoding: "json",
        preview: {},
        attributes: { evidenceSource: marker },
      }).success,
    ).toBe(false);
  });

  it.each([
    ["available without preview", "available", "json", {}],
    ["available with hash", "available", "json", { preview: {}, hash: "x" }],
    ["reference with preview", "reference", "reference", { preview: null }],
    ["reference with URI", "reference", "reference", { uri: "asset://x" }],
    [
      "not-captured with hash",
      "not-captured",
      "reference",
      { hash: validReferenceHash },
    ],
    [
      "not-captured with size",
      "not-captured",
      "reference",
      { sizeBytes: 0 },
    ],
  ] as const)("rejects %s", (_name, state, encoding, fields) => {
    expect(
      CruxArtifactRecordSchema.safeParse({
        ...evidenceArtifact(state),
        encoding,
        ...fields,
      }).success,
    ).toBe(false);
  });
});
