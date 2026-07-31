import { describe, expect, it } from "vitest";
import type { CruxGraphRecord } from "@use-crux/core/observability";

import { evidenceEventProjection } from "../src/evidence-events";

describe("evidence OTel privacy allowlist", () => {
  it("excludes every qualified identity, policy, and payload-adjacent field", () => {
    const projection = evidenceEventProjection({
      schemaVersion: 5,
      recordId: "rec_private_evidence",
      type: "edge",
      operationId: "run_private_operation",
      runId: "run_private_producer",
      segmentId: "seg_private",
      segmentSeq: 1,
      edgeId: "edge_private_evidence",
      edgeType: "evidence.for",
      from: {
        kind: "artifact",
        id: "artifact_1111111111111111",
      },
      to: { kind: "artifact", id: "artifact_2222222222222222" },
      createdAt: "2026-07-30T00:00:00.000Z",
      attributes: {
        evidenceId: "evidence_3333333333333333",
        role: "verification",
        evidenceKind: "validation.feedback",
        conclusion: "passed",
        observedAt: "2026-07-29T23:59:59.000Z",
        recordedAt: "2026-07-30T00:00:00.000Z",
        producer: { kind: "span", id: "4444444444444444" },
        supersedesEvidenceIds: ["evidence_5555555555555555"],
        captureState: "available",
        sourceMode: "inline",
        idempotencyKeyHash: "a".repeat(64),
        contentDigestVersion: 1,
        contentDigest: `sha256:${"b".repeat(64)}`,
      },
    } as unknown as CruxGraphRecord);

    expect(projection?.attributes).toEqual({
      "crux.evidence.id": "evidence_3333333333333333",
      "crux.evidence.role": "verification",
      "crux.evidence.kind": "validation.feedback",
      "crux.evidence.conclusion": "passed",
      "crux.evidence.subject_kind": "artifact",
    });
    const serialized = JSON.stringify(projection?.attributes);
    for (const excluded of [
      "artifact_1111111111111111",
      "artifact_2222222222222222",
      "4444444444444444",
      "evidence_5555555555555555",
      "observedAt",
      "recordedAt",
      "captureState",
      "sourceMode",
      "idempotencyKeyHash",
      "contentDigest",
      "sha256:",
    ]) {
      expect(serialized).not.toContain(excluded);
    }
  });
});
