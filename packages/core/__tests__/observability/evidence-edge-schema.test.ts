import { describe, expect, it } from "vitest";
import {
  CruxEdgeRecordSchema,
  EvidenceEdgeAttributesSchema,
} from "../../src/observability";

const edge = {
  schemaVersion: 5,
  recordId: "rec_evidence_edge",
  type: "edge",
  operationId: "run_evidence_edge",
  runId: "run_evidence_edge",
  segmentId: "seg_evidence_edge",
  segmentSeq: 1,
  edgeId: "edge_evidence_edge",
  edgeType: "evidence.for",
  from: { kind: "artifact", id: "artifact_1111111111111111" },
  to: { kind: "span", id: "2222222222222222" },
  createdAt: "2026-07-28T12:00:00.000Z",
  attributes: {
    evidenceId: "evidence_3333333333333333",
    role: "verification",
    evidenceKind: "score.report",
    conclusion: "passed",
    observedAt: "2026-07-28T11:59:59.000Z",
    recordedAt: "2026-07-28T12:00:00.000Z",
    producer: { kind: "span", id: "2222222222222222" },
    supersedesEvidenceIds: ["evidence_4444444444444444"],
    captureState: "reference",
    sourceMode: "reference",
  },
} as const;

describe("evidence edge schema", () => {
  it("accepts bounded qualified attributes on evidence.for", () => {
    expect(
      EvidenceEdgeAttributesSchema.safeParse(edge.attributes).success,
    ).toBe(true);
    expect(CruxEdgeRecordSchema.safeParse(edge).success).toBe(true);
  });

  it("accepts the complete versioned identity for idempotent evidence", () => {
    const attributes = {
      ...edge.attributes,
      idempotencyKeyHash: "a".repeat(64),
      sourceMode: "inline",
      contentDigestVersion: 1,
      contentDigest: `sha256:${"b".repeat(64)}`,
    } as const;

    expect(EvidenceEdgeAttributesSchema.safeParse(attributes).success).toBe(
      true,
    );
  });

  it.each([
    {
      name: "missing attributes",
      record: { ...edge, attributes: undefined },
    },
    {
      name: "missing source mode",
      record: {
        ...edge,
        attributes: {
          ...edge.attributes,
          sourceMode: undefined,
        },
      },
    },
    {
      name: "missing capture state",
      record: {
        ...edge,
        attributes: {
          ...edge.attributes,
          captureState: undefined,
        },
      },
    },
    {
      name: "missing producer",
      record: {
        ...edge,
        attributes: {
          ...edge.attributes,
          producer: undefined,
        },
      },
    },
    {
      name: "public execution producer discriminant",
      record: {
        ...edge,
        attributes: {
          ...edge.attributes,
          producer: { kind: "execution", id: "2222222222222222" },
        },
      },
    },
    {
      name: "span producer with run-like ID",
      record: {
        ...edge,
        attributes: {
          ...edge.attributes,
          producer: { kind: "span", id: "run_2222222222222222" },
        },
      },
    },
    {
      name: "all-zero span producer",
      record: {
        ...edge,
        attributes: {
          ...edge.attributes,
          producer: { kind: "span", id: "0000000000000000" },
        },
      },
    },
    {
      name: "producer with extra key",
      record: {
        ...edge,
        attributes: {
          ...edge.attributes,
          producer: {
            kind: "span",
            id: "2222222222222222",
            delegatedBy: "run_private",
          },
        },
      },
    },
    {
      name: "wrong role conclusion",
      record: {
        ...edge,
        attributes: {
          ...edge.attributes,
          role: "change",
          conclusion: "passed",
        },
      },
    },
    {
      name: "intent conclusion",
      record: {
        ...edge,
        attributes: {
          ...edge.attributes,
          role: "intent",
          conclusion: "passed",
        },
      },
    },
    {
      name: "unbounded custom kind",
      record: {
        ...edge,
        attributes: {
          ...edge.attributes,
          evidenceKind: `custom.${"x".repeat(122)}`,
        },
      },
    },
    {
      name: "unknown metadata",
      record: {
        ...edge,
        attributes: {
          ...edge.attributes,
          data: { secret: true },
        },
      },
    },
    {
      name: "duplicate supersession identity",
      record: {
        ...edge,
        attributes: {
          ...edge.attributes,
          supersedesEvidenceIds: [
            "evidence_4444444444444444",
            "evidence_4444444444444444",
          ],
        },
      },
    },
    {
      name: "idempotency hash without durable content identity",
      record: {
        ...edge,
        attributes: {
          ...edge.attributes,
          idempotencyKeyHash: "a".repeat(64),
        },
      },
    },
    {
      name: "content digest without idempotency hash",
      record: {
        ...edge,
        attributes: {
          ...edge.attributes,
          contentDigestVersion: 1,
          contentDigest: `sha256:${"b".repeat(64)}`,
        },
      },
    },
    {
      name: "unsupported content digest version",
      record: {
        ...edge,
        attributes: {
          ...edge.attributes,
          idempotencyKeyHash: "a".repeat(64),
          contentDigestVersion: 2,
          contentDigest: `sha256:${"b".repeat(64)}`,
        },
      },
    },
    {
      name: "reference source mode with non-reference capture state",
      record: {
        ...edge,
        attributes: {
          ...edge.attributes,
          captureState: "available",
          idempotencyKeyHash: "a".repeat(64),
          sourceMode: "reference",
          contentDigestVersion: 1,
          contentDigest: `sha256:${"b".repeat(64)}`,
        },
      },
    },
    {
      name: "inline source mode without capture state",
      record: {
        ...edge,
        attributes: {
          ...edge.attributes,
          captureState: undefined,
          idempotencyKeyHash: "a".repeat(64),
          sourceMode: "inline",
          contentDigestVersion: 1,
          contentDigest: `sha256:${"b".repeat(64)}`,
        },
      },
    },
  ])("rejects $name", ({ record }) => {
    expect(CruxEdgeRecordSchema.safeParse(record).success).toBe(false);
  });
});
