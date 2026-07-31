import { describe, expect, it } from "vitest";
import fixture from "../../src/evidence/fixtures/identity-v1.json";
import type {
  CruxArtifactId,
  CruxGraphNodeRef,
  CruxRunId,
  CruxSpanId,
} from "../../src/observability";
import {
  deterministicEvidenceArtifactId,
  deterministicEvidenceId,
  evidenceContentDigest,
} from "../../src/evidence/idempotency";
import type {
  CruxEvidenceId,
  EvidencePayloadState,
  EvidenceRecord,
  EvidenceRef,
} from "../../src/evidence/record-types";
import type { EvidenceSubject } from "../../src/evidence/subjects";
import type { JsonValue } from "../../src/storage";

describe("evidence identity v1 golden", () => {
  it("pins deterministic relationship and inline artifact identities", () => {
    const evidenceId = deterministicEvidenceId(
      canonicalNode(fixture.input.subject),
      fixture.input.role,
      fixture.input.evidenceKind,
      fixture.input.idempotencyKey,
    );

    expect(evidenceId).toBe(fixture.expected.evidenceId);
    expect(deterministicEvidenceArtifactId(evidenceId)).toBe(
      fixture.expected.artifactId,
    );
  });

  it("pins the shared execution subject identity domain", () => {
    for (const testCase of fixture.executionIdentityCases) {
      expect(
        deterministicEvidenceId(
          executionIdentitySubject(testCase.subject),
          fixture.input.role,
          fixture.input.evidenceKind,
          fixture.input.idempotencyKey,
        ),
      ).toBe(testCase.evidenceId);
    }
  });

  it.each([
    {
      name: "reference",
      sourceMode: "reference" as const,
      payloadState: "reference" as const,
      expected: fixture.expected.referenceDigest,
    },
    {
      name: "available",
      sourceMode: "inline" as const,
      payloadState: "available" as const,
      data: fixture.inline.available,
      expected: fixture.expected.availableDigest,
    },
    {
      name: "captured reference",
      sourceMode: "inline" as const,
      payloadState: "reference" as const,
      artifact: fixture.inline.capturedReference,
      expected: fixture.expected.capturedReferenceDigest,
    },
    {
      name: "not captured",
      sourceMode: "inline" as const,
      payloadState: "not-captured" as const,
      expected: fixture.expected.notCapturedDigest,
    },
  ])(
    "pins the $name digest",
    ({ sourceMode, payloadState, data, artifact, expected }) => {
      expect(
        evidenceContentDigest(
          evidenceRecord(payloadState, data),
          sourceMode,
          canonicalNode(fixture.input.subject),
          canonicalNode(fixture.input.source),
          artifact,
        ),
      ).toBe(expected);
    },
  );

  it.each([
    {
      name: "empty supersession",
      data: fixture.inline.available,
      supersedesEvidenceIds: [],
      expected: fixture.expected.emptySupersessionDigest,
    },
    {
      name: "integer-like preview keys",
      data: fixture.inline.integerLikeKeys,
      expected: fixture.expected.integerLikeKeyDigest,
    },
    {
      name: "literal and raw Unicode separators",
      data: fixture.inline.separators,
      expected: fixture.expected.separatorDigest,
    },
    {
      name: "Core-policy-processed URL and media value",
      data: fixture.inline.policyProcessed,
      expected: fixture.expected.policyProcessedDigest,
    },
    {
      name: "JSON numeric boundaries",
      data: fixture.inline.numericBoundaries,
      expected: fixture.expected.numericBoundaryDigest,
    },
  ])(
    "pins the $name canonical edge case",
    ({
      data,
      supersedesEvidenceIds = fixture.input.supersedesEvidenceIds,
      expected,
    }) => {
      expect(
        evidenceContentDigest(
          evidenceRecord("available", data, supersedesEvidenceIds),
          "inline",
          canonicalNode(fixture.input.subject),
          canonicalNode(fixture.input.source),
        ),
      ).toBe(expected);
    },
  );
});

function evidenceRecord(
  payloadState: EvidencePayloadState,
  data?: JsonValue,
  supersedesEvidenceIds: readonly string[] = fixture.input
    .supersedesEvidenceIds,
): EvidenceRecord<"verification"> {
  const subject = canonicalNode(fixture.input.subject);
  const ref = Object.freeze({
    kind: "execution.evidence",
    id: fixture.expected.evidenceId as CruxEvidenceId,
    subject,
    role: fixture.input.role,
    evidenceKind: fixture.input.evidenceKind,
    recordedAt: "2099-01-01T00:00:00.000Z",
  }) satisfies EvidenceRef<"verification">;
  return Object.freeze({
    ref,
    source: canonicalNode(fixture.input.source),
    conclusion: fixture.input.conclusion,
    observedAt: fixture.input.observedAt,
    supersedes: Object.freeze(
      supersedesEvidenceIds.map((id) =>
        Object.freeze({
          ...ref,
          id: id as CruxEvidenceId,
        }),
      ),
    ),
    payloadState,
    ...(data !== undefined ? { data: Object.freeze(data) } : {}),
  });
}

function executionIdentitySubject(value: {
  readonly kind: string;
  readonly id: string;
}): EvidenceSubject {
  if (value.kind === "run") {
    return { kind: "execution", id: value.id as CruxRunId };
  }
  return { kind: "execution", id: value.id as CruxSpanId };
}

function canonicalNode(value: {
  readonly kind: "artifact";
  readonly id: string;
}): Extract<CruxGraphNodeRef, { readonly kind: "artifact" }> {
  return Object.freeze({
    kind: "artifact",
    id: value.id as CruxArtifactId,
  });
}
